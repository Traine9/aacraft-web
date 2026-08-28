/**
 * AACraft calculator page: one plain state object + one render pass over the engine result.
 * Everything is client-side; `data.json` is fetched once, `buildIndex` runs once.
 */
import './style.css';
import {
  buildIndex,
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
import { patchBuyList, renderBuyList } from './ui/buylist';
import { clear, el, gold, int, must } from './ui/dom';
import { buildSearchItems, initSearch, type SearchHandle, type SearchItem } from './ui/search';
import { renderTree } from './ui/tree';

// --------------------------------------------------------------------------------- state

interface State {
  target: number | null;
  qty: number;
  goldPerLabor: number;
  profReduction: boolean;
  /** Per-item unit price typed into the buy list. Reset when the target changes. */
  priceOverride: Record<number, number>;
  /** Per-item forced craft/buy. Reset when the target changes. */
  modeOverride: Record<number, Mode>;
}

const state: State = {
  target: null,
  qty: 1,
  goldPerLabor: 0.3,
  profReduction: true,
  priceOverride: {},
  modeOverride: {},
};

/** Pure view state — survives recalcs, never feeds the engine. */
const view = {
  filter: '',
  /** Expanded craft nodes, by item id. */
  expanded: new Set<number>(),
};

let index: CraftIndex | null = null;
let searchHandle: SearchHandle | null = null;

// ----------------------------------------------------------------------------- elements

const els = {
  status: must<HTMLElement>('#status'),
  results: must<HTMLElement>('#results'),
  updated: must<HTMLElement>('#updated'),
  search: must<HTMLInputElement>('#search'),
  searchPopup: must<HTMLElement>('#search-popup'),
  qty: must<HTMLInputElement>('#qty'),
  goldPerLabor: must<HTMLInputElement>('#gold-per-labor'),
  prof: must<HTMLInputElement>('#prof'),
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

// ------------------------------------------------------------------------------- render

function setStatus(message: string, kind: 'info' | 'error' = 'info'): void {
  els.status.textContent = message;
  els.status.className = `status status-${kind}`;
  els.status.hidden = false;
  els.results.hidden = true;
}

/** First render of a new target: open the root and its direct sub-crafts. */
function seedExpanded(root: TreeNode): void {
  if (view.expanded.size > 0) return;
  view.expanded.add(root.itemId);
  for (const child of root.children ?? []) {
    if (child.mode === 'craft') view.expanded.add(child.itemId);
  }
}

const MAX_EXPAND_ALL = 3000;

function expandAll(root: TreeNode): void {
  let budget = MAX_EXPAND_ALL;
  const walk = (node: TreeNode): void => {
    if (budget-- <= 0 || !node.children?.length) return;
    view.expanded.add(node.itemId);
    for (const child of node.children) walk(child);
  };
  walk(root);
}

/**
 * A price override can push its item out of the buy list (it became cheaper to craft, or a parent
 * flipped to "buy"). Keep a zero-qty row for it so the edit stays visible, keeps focus while the
 * user is still typing, and can be reset. Totals are untouched — these rows cost nothing.
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
  extra.sort((a, b) => a.name.localeCompare(b.name) || a.itemId - b.itemId);
  return [...rows, ...extra];
}

/**
 * The single recalc + repaint path. Every control ends up here.
 *
 * `patchBuy` is set while a price field has focus: the table is then updated in place instead of
 * being rebuilt, so the caret is not lost and rows do not jump around mid-edit.
 */
function render(opts: { patchBuy?: boolean } = {}): void {
  if (!index) return;
  if (state.target === null) {
    setStatus('Pick an item above (or use a preset) to see the full breakdown.');
    return;
  }

  const result: CalcResult = calculate(index, {
    target: state.target,
    qty: state.qty,
    goldPerLabor: state.goldPerLabor,
    profReduction: state.profReduction,
    priceOverride: state.priceOverride,
    modeOverride: state.modeOverride,
  });

  if (result.error) {
    setStatus(result.error, 'error');
    return;
  }

  els.status.hidden = true;
  els.results.hidden = false;
  els.targetLine.textContent = `${int(state.qty)} × ${itemName(index, state.target)} (#${state.target})`;

  seedExpanded(result.tree);
  const idx = index;
  renderTree(els.tree, result.tree, {
    expanded: view.expanded,
    canCraft: (itemId) => idx.recipesByProduct.has(itemId),
    modeOverrideOf: (itemId) => state.modeOverride[itemId],
    onToggleExpand: (itemId) => {
      if (view.expanded.has(itemId)) view.expanded.delete(itemId);
      else view.expanded.add(itemId);
      render();
    },
    onSetMode: (itemId, mode) => {
      if (mode === null) delete state.modeOverride[itemId];
      else state.modeOverride[itemId] = mode;
      render();
    },
  });

  const buyRows = withOverrideRows(result.buyList, idx);
  const buyHandlers = {
    onPriceInput: (itemId: number, raw: string) => {
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n) || n < 0) delete state.priceOverride[itemId];
      else state.priceOverride[itemId] = n;
      render({ patchBuy: true });
    },
    onPriceReset: (itemId: number) => {
      delete state.priceOverride[itemId];
      render();
    },
    // Deferred: a blur caused by clicking another control must not rebuild the DOM under that
    // click (a removed mousedown target never gets its `click` event). Moving from one price
    // field straight to the next keeps the table as it is — rebuild once editing really stops.
    onPriceCommit: () => {
      setTimeout(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLInputElement && focused.dataset['testid'] === 'price-input') return;
        render();
      }, 0);
    },
  };
  if (opts.patchBuy) patchBuyList(els.buyBody, buyRows, buyHandlers);
  else renderBuyList(els.buyBody, buyRows, view.filter, buyHandlers);

  const t = result.totals;
  els.totalBuy.textContent = gold(t.buyGold);
  els.totalFees.textContent = gold(t.feeGold);
  els.totalLabor.textContent = int(t.labor);
  els.totalLaborGold.textContent = gold(t.laborGold);
  els.totalGrand.textContent = gold(t.grandTotal);

  // Expand/collapse all need the current tree, so they are (re)wired per render.
  els.expandAll.onclick = () => {
    expandAll(result.tree);
    render();
  };
  els.collapseAll.onclick = () => {
    view.expanded.clear();
    view.expanded.add(result.tree.itemId);
    render();
  };
}

// ------------------------------------------------------------------------------- actions

/** A new target invalidates every per-item override and the collapse state (SPEC). */
function setTarget(itemId: number, qty?: number): void {
  state.target = itemId;
  if (qty !== undefined) {
    state.qty = qty;
    els.qty.value = String(qty);
  }
  state.priceOverride = {};
  state.modeOverride = {};
  view.expanded.clear();
  render();
}

function readQty(): void {
  const n = Math.floor(Number(els.qty.value));
  state.qty = Number.isFinite(n) && n >= 1 ? n : 1;
}

function readGoldPerLabor(): void {
  const n = Number(els.goldPerLabor.value);
  state.goldPerLabor = Number.isFinite(n) && n >= 0 ? n : 0;
}

function renderPresets(idx: CraftIndex): void {
  clear(els.presets);
  els.presets.appendChild(el('span', { className: 'presets-label', text: 'Presets:' }));
  for (const preset of PRESETS) {
    const btn = el('button', {
      className: 'preset',
      text: preset.label,
      testid: 'preset-button',
      attrs: { type: 'button', 'data-item-id': String(preset.itemId), 'data-qty': String(preset.qty) },
    });
    btn.addEventListener('click', () => {
      searchHandle?.setValue(itemName(idx, preset.itemId));
      setTarget(preset.itemId, preset.qty);
    });
    els.presets.appendChild(btn);
  }
}

function wireControls(idx: CraftIndex, items: readonly SearchItem[]): void {
  searchHandle = initSearch({
    input: els.search,
    popup: els.searchPopup,
    items,
    onPick: (item) => setTarget(item.id),
  });

  els.qty.addEventListener('input', () => {
    readQty();
    render();
  });
  els.goldPerLabor.addEventListener('input', () => {
    readGoldPerLabor();
    render();
  });
  els.prof.addEventListener('change', () => {
    state.profReduction = els.prof.checked;
    render();
  });
  els.filter.addEventListener('input', () => {
    view.filter = els.filter.value;
    render();
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
    readQty();
    readGoldPerLabor();
    state.profReduction = els.prof.checked;
    view.filter = els.filter.value;
    wireControls(index, buildSearchItems(index));
    render();
  } catch (err) {
    setStatus(`Could not load data.json — ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

void boot();
