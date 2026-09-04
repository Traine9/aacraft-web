/**
 * AACraft calculator page.
 *
 * Two paint paths, and only two:
 *  - `recalc()` runs the engine and repaints — every control that feeds the engine ends here.
 *  - `repaint()` re-draws `lastResult` — expand/collapse and the buy-list filter stop here.
 * Engine inputs live in the DOM (`controls()` reads and sanitizes them); only the things the DOM
 * cannot hold — the target and the per-item overrides — are kept in `state`.
 */
import './style.css';
import {
  buildIndex,
  byNameThenId,
  calculate,
  itemName,
  type BuyRow,
  type CalcResult,
  type CraftIndex,
  type DataSet,
  type Mode,
  type TreeNode,
} from './engine';
import { PRESETS } from './presets';
import {
  applyFilter,
  isEditingPrice,
  isPriceInput,
  patchBuyList,
  renderBuyList,
  PRICE_RESET,
} from './ui/buylist';
import { clear, el, gold, int, must } from './ui/dom';
import { buildSearchItems, initSearch, type SearchItem } from './ui/search';
import { MODE_BTN, RECIPE_SELECT, renderTree, TREE_TOGGLE } from './ui/tree';

// --------------------------------------------------------------------------------- state

interface State {
  target: number | null;
  /** Per-item unit price typed into the buy list. Reset when the target changes. */
  priceOverride: Record<number, number>;
  /** Per-item forced craft/buy. Reset when the target changes. */
  modeOverride: Record<number, Mode>;
  /** Per-item recipe choice, for items several recipes make. Reset when the target changes. */
  recipeOverride: Record<number, number>;
}

const state: State = { target: null, priceOverride: {}, modeOverride: {}, recipeOverride: {} };

/** Pure view state — survives recalcs, never feeds the engine. */
const view = {
  /** Expanded craft nodes, by item id. */
  expanded: new Set<number>(),
  /** Whether `expanded` has been seeded for the current target (see `seedExpanded`). */
  seeded: false,
};

let index: CraftIndex | null = null;
/** The last successful engine result — what `repaint()` draws. */
let lastResult: CalcResult | null = null;
/** Pending deferred rebuild after a price field lost focus (see the `focusout` handler). */
let pendingRebuild: ReturnType<typeof setTimeout> | null = null;

// ----------------------------------------------------------------------------- elements

const els = {
  status: must<HTMLElement>('#status'),
  results: must<HTMLElement>('#results'),
  updated: must<HTMLElement>('#updated'),
  controls: must<HTMLElement>('.controls'),
  search: must<HTMLInputElement>('#search'),
  searchPopup: must<HTMLElement>('#search-popup'),
  qty: must<HTMLInputElement>('#qty'),
  goldPerLabor: must<HTMLInputElement>('#gold-per-labor'),
  prof: must<HTMLSelectElement>('#prof'),
  profExact: must<HTMLInputElement>('#prof-exact'),
  profExactToggle: must<HTMLButtonElement>('#prof-exact-toggle'),
  presets: must<HTMLElement>('#presets'),
  targetLine: must<HTMLElement>('#target-line'),
  tree: must<HTMLElement>('#tree'),
  expandAll: must<HTMLButtonElement>('#expand-all'),
  collapseAll: must<HTMLButtonElement>('#collapse-all'),
  filter: must<HTMLInputElement>('#filter'),
  buyBody: must<HTMLTableSectionElement>('#buy-body'),
  totalBuy: must<HTMLElement>('#total-buy'),
  totalFees: must<HTMLElement>('#total-fees'),
  totalLabor: must<HTMLElement>('#total-labor'),
  totalLaborGold: must<HTMLElement>('#total-labor-gold'),
  totalGrand: must<HTMLElement>('#total-grand'),
};

/**
 * Whether the exact-percent field is open — the one bit `setProfExactOpen` renders from, kept here
 * rather than read back off `profExact.hidden` so the control has a source of truth that is not a
 * presentation attribute (and is a plain boolean, not the DOM's `boolean | "until-found"`).
 */
let profExactOpen = false;

/** The engine inputs, read straight from the fields; the engine sanitizes what it is given. */
function controls(): { qty: number; goldPerLabor: number; profPercent: number; filter: string } {
  const qty = Math.floor(Number(els.qty.value));
  const gpl = Number(els.goldPerLabor.value);
  return {
    qty: Number.isFinite(qty) && qty >= 1 ? qty : 1,
    goldPerLabor: Number.isFinite(gpl) && gpl >= 0 ? gpl : 0,
    // The exact field, while it is open, overrides the preset list behind it.
    profPercent: Number(profExactOpen ? els.profExact.value : els.prof.value),
    filter: els.filter.value,
  };
}

// ------------------------------------------------------------------------------- render

/**
 * The only writer of the proficiency control's appearance: opening it reveals the exact field over
 * the (now inert) preset list and seeds it from the list, closing it hands control back. Every
 * property below is derived from `open`, so the two states cannot drift apart.
 */
function setProfExactOpen(open: boolean): void {
  profExactOpen = open;
  if (open) els.profExact.value = els.prof.value;
  els.profExact.hidden = !open;
  els.prof.disabled = open;
  els.profExactToggle.textContent = open ? '−' : '+';
  els.profExactToggle.setAttribute('aria-pressed', String(open));
  els.profExactToggle.title = open ? 'Back to the preset list' : 'Set an exact percentage';
  if (open) els.profExact.focus();
}

function setStatus(message: string, kind: 'info' | 'error' = 'info'): void {
  els.status.textContent = message;
  els.status.className = `status status-${kind}`;
  els.status.hidden = false;
  els.results.hidden = true;
}

function clearStatus(): void {
  els.status.hidden = true;
  els.results.hidden = false;
}

/** First paint of a new target: open the root and its direct sub-crafts, once. */
function seedExpanded(root: TreeNode): void {
  if (view.seeded) return;
  view.seeded = true;
  view.expanded.add(root.itemId);
  for (const child of root.children ?? []) {
    if (child.mode === 'craft') view.expanded.add(child.itemId);
  }
}

function expandAll(root: TreeNode): void {
  const walk = (node: TreeNode): void => {
    if (!node.children?.length) return;
    view.expanded.add(node.itemId);
    for (const child of node.children) walk(child);
  };
  walk(root);
}

/**
 * A price override can push its item out of the buy list (it became cheaper to craft, or a parent
 * flipped to "buy"). Keep a zero-qty row for it so the edit stays visible, keeps focus while the
 * user is still typing, and can be reset. Totals are untouched — these rows cost nothing.
 * This is the only place synthetic buy rows are made.
 */
function withOverrideRows(rows: readonly BuyRow[], idx: CraftIndex): BuyRow[] {
  const present = new Set(rows.map((r) => r.itemId));
  const extra: BuyRow[] = [];
  for (const [key, value] of Object.entries(state.priceOverride)) {
    const itemId = Number(key);
    if (present.has(itemId)) continue;
    extra.push({
      itemId,
      name: itemName(idx, itemId),
      qty: 0,
      unitPrice: value,
      total: 0,
      noPrice: false,
      overridden: true,
    });
  }
  if (extra.length === 0) return rows as BuyRow[];
  extra.sort(byNameThenId);
  return [...rows, ...extra];
}

/** Run the engine, then paint. Every control that changes an engine input calls this. */
function recalc(opts: { patchBuy?: boolean } = {}): void {
  cancelPendingRebuild();
  if (!index) return;
  if (state.target === null) {
    lastResult = null;
    setStatus('Pick an item above (or use a preset) to see the full breakdown.');
    return;
  }

  const c = controls();
  const result = calculate(index, {
    target: state.target,
    qty: c.qty,
    goldPerLabor: c.goldPerLabor,
    profPercent: c.profPercent,
    priceOverride: state.priceOverride,
    modeOverride: state.modeOverride,
    recipeOverride: state.recipeOverride,
  });
  if (result.error) {
    lastResult = null;
    setStatus(result.error, 'error');
    return;
  }

  lastResult = result;
  repaint(opts);
}

/**
 * Paint `lastResult`. No engine call — view-only controls stop here.
 *
 * `patchBuy` is set while a price field has focus: the table is then updated in place instead of
 * being rebuilt, so the caret is not lost and rows do not jump around mid-edit.
 */
function repaint(opts: { patchBuy?: boolean } = {}): void {
  cancelPendingRebuild();
  const result = lastResult;
  if (!result || !index || state.target === null) return;
  const c = controls();

  clearStatus();
  els.targetLine.textContent = `${int(c.qty)} × ${itemName(index, state.target)} (#${state.target})`;

  seedExpanded(result.tree);
  renderTree(els.tree, result.tree, view.expanded);

  const rows = withOverrideRows(result.buyList, index);
  if (opts.patchBuy) patchBuyList(els.buyBody, rows);
  else renderBuyList(els.buyBody, rows, c.filter);

  const t = result.totals;
  els.totalBuy.textContent = gold(t.buyGold);
  els.totalFees.textContent = gold(t.feeGold);
  els.totalLabor.textContent = int(t.labor);
  els.totalLaborGold.textContent = gold(t.laborGold);
  els.totalGrand.textContent = gold(t.grandTotal);
}

// ------------------------------------------------------------------------------- actions

/** A new target invalidates every per-item override and the collapse state (SPEC). */
function setTarget(itemId: number, qty?: number): void {
  state.target = itemId;
  if (qty !== undefined) els.qty.value = String(qty);
  state.priceOverride = {};
  state.modeOverride = {};
  state.recipeOverride = {};
  view.expanded.clear();
  view.seeded = false;
  recalc();
}

function setPriceOverride(itemId: number, raw: string): void {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n) || n < 0) delete state.priceOverride[itemId];
  else state.priceOverride[itemId] = n;
}

function cancelPendingRebuild(): void {
  if (pendingRebuild === null) return;
  clearTimeout(pendingRebuild);
  pendingRebuild = null;
}

/** `data-item-id` of the element (or its closest ancestor) matching `selector`, if any. */
function itemIdFrom(target: EventTarget | null, selector: string): number | null {
  if (!(target instanceof Element)) return null;
  const hit = target.closest<HTMLElement>(selector);
  const raw = hit?.dataset['itemId'];
  return raw === undefined ? null : Number(raw);
}

function renderPresets(idx: CraftIndex): void {
  clear(els.presets);
  els.presets.appendChild(el('span', { className: 'presets-label', text: 'Presets:' }));
  for (const preset of PRESETS) {
    // data-item-id / data-qty are the e2e hooks for the preset buttons.
    const btn = el('button', {
      className: 'preset',
      text: preset.label,
      testid: 'preset-button',
      attrs: {
        type: 'button',
        'data-item-id': String(preset.itemId),
        'data-qty': String(preset.qty),
      },
    });
    btn.addEventListener('click', () => {
      els.search.value = itemName(idx, preset.itemId);
      setTarget(preset.itemId, preset.qty);
    });
    els.presets.appendChild(btn);
  }
}

/** Everything is wired exactly once, here; the render passes only paint. */
function wireControls(idx: CraftIndex, items: readonly SearchItem[]): void {
  initSearch({
    input: els.search,
    popup: els.searchPopup,
    items,
    onPick: (item) => setTarget(item.id),
  });

  // Quantity, gold-per-labor and both proficiency fields live in the same bar and all feed the
  // engine; the search box is the one input there that does not. `<select>` fires `input` too.
  els.controls.addEventListener('input', (ev) => {
    if (ev.target === els.search) return;
    recalc();
  });

  // "+" opens an exact percentage on top of the preset list; pressing it again drops back to the
  // list, so the override is always reversible — same contract as the craft/buy and recipe controls.
  els.profExactToggle.addEventListener('click', () => {
    const before = controls().profPercent;
    setProfExactOpen(!profExactOpen);
    // Opening seeds the field from the list, so the percentage usually does not move — and a full
    // engine pass plus a tree/buy-list rebuild to redraw what is already on screen is worth skipping.
    if (controls().profPercent !== before) recalc();
  });

  // View only: hide rows, keep the tree (and its scroll position) exactly as it is.
  els.filter.addEventListener('input', () => applyFilter(els.buyBody, els.filter.value));

  els.expandAll.addEventListener('click', () => {
    if (!lastResult) return;
    expandAll(lastResult.tree);
    repaint();
  });
  els.collapseAll.addEventListener('click', () => {
    if (!lastResult) return;
    view.expanded.clear();
    repaint();
  });

  // --- buy list: one listener per event type, for the whole table ---------------------------
  els.buyBody.addEventListener('input', (ev) => {
    const input = ev.target;
    if (!isPriceInput(input)) return;
    const itemId = Number(input.dataset['itemId']);
    setPriceOverride(itemId, input.value);
    recalc({ patchBuy: true });
  });
  // Deferred: a blur caused by clicking another control must not rebuild the DOM under that
  // click (a removed mousedown target never gets its `click` event). Moving from one price
  // field straight to the next keeps the table as it is — rebuild once editing really stops.
  els.buyBody.addEventListener('focusout', (ev) => {
    if (!isPriceInput(ev.target)) return;
    // Focus going to another control of this table (the next price field, a reset button) is
    // still editing: those handlers repaint by themselves, and a rebuild between the user's
    // mousedown and mouseup would delete the very button they are pressing.
    if (ev.relatedTarget instanceof Node && els.buyBody.contains(ev.relatedTarget)) return;
    cancelPendingRebuild();
    pendingRebuild = setTimeout(() => {
      pendingRebuild = null;
      if (!isEditingPrice()) repaint();
    }, 0);
  });
  els.buyBody.addEventListener('click', (ev) => {
    const itemId = itemIdFrom(ev.target, `[data-testid="${PRICE_RESET}"]`);
    if (itemId === null) return;
    delete state.priceOverride[itemId];
    recalc();
  });

  // --- craft tree: twisties and craft/buy toggles -------------------------------------------
  els.tree.addEventListener('click', (ev) => {
    const toggled = itemIdFrom(ev.target, `[data-testid="${TREE_TOGGLE}"]`);
    if (toggled !== null) {
      if (!view.expanded.delete(toggled)) view.expanded.add(toggled);
      repaint();
      return;
    }

    if (!(ev.target instanceof Element)) return;
    const btn = ev.target.closest<HTMLButtonElement>(`.${MODE_BTN}`);
    if (!btn) return;
    const itemId = Number(btn.dataset['itemId']);
    // The pressed button is the active override: clicking it again returns the item to automatic.
    if (btn.getAttribute('aria-pressed') === 'true') delete state.modeOverride[itemId];
    else state.modeOverride[itemId] = btn.dataset['mode'] === 'buy' ? 'buy' : 'craft';
    recalc();
  });

  // Recipe selector on multi-recipe nodes. The first option is the engine's default (the select
  // renders them in default order), so picking it back returns the item to automatic — every
  // override in the app has a way back to auto.
  els.tree.addEventListener('change', (ev) => {
    if (!(ev.target instanceof HTMLSelectElement)) return;
    const itemId = itemIdFrom(ev.target, `[data-testid="${RECIPE_SELECT}"]`);
    if (itemId === null) return;
    if (ev.target.value === ev.target.options[0]?.value) delete state.recipeOverride[itemId];
    else state.recipeOverride[itemId] = Number(ev.target.value);
    recalc();
  });

  renderPresets(idx);
}

// --------------------------------------------------------------------------------- boot

async function boot(): Promise<void> {
  try {
    // Relative to the document, so the page works from any subpath of the host site.
    const res = await fetch(new URL('data.json', document.baseURI));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as DataSet;
    index = buildIndex(data);
    els.updated.textContent = data.updated;
    wireControls(index, buildSearchItems(index));
    recalc();
  } catch (err) {
    setStatus(`Could not load data.json — ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

void boot();
