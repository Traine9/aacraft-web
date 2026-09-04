/**
 * calculator-page.ts — the one page object of the suite (the app is one page).
 *
 * CONVENTIONS (same as erp-test): a page object owns SELECTORS, NAVIGATION and typed READS of
 * on-screen state — it never asserts a business expectation. Specs compare its reads to the engine
 * oracle (`lib/oracle.ts`). No spec may contain a bare selector, a `data-testid` or a `data-*`
 * convention; every hook lives here, behind a named member.
 *
 * THREE DOM FACTS the members below encode, because getting them wrong silently passes tests:
 *  - the two lists hide things in OPPOSITE ways. The buy-list filter HIDES rows (`[hidden]`) and
 *    leaves them in the DOM (`buy-empty` is always there too), so "visible rows" must be
 *    `buy-row:not([hidden])` — hence `visibleBuyRows` vs `buyRows`. Collapsing the craft tree
 *    REMOVES the nodes instead (it is re-rendered from the expanded set), so a collapsed subtree
 *    has zero nodes to count, not hidden ones — hence `renderedTreeNodeIds()`.
 *  - an item id can appear at several places in the craft tree (the same material feeding two
 *    recipes). Mode is decided per ITEM, so all its nodes agree — `treeNode()` takes the first, and
 *    node-scoped locators use `> .node-row` so a child's buttons and badges never match.
 *  - boolean display flags are `data-<name>="true"` when on and ABSENT when off (`src/ui/dom.ts`
 *    `setFlags`), which makes "not overridden" a missing attribute. Specs get the positive locator
 *    (`overriddenRow`) and count it instead of asserting on an absent attribute.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { parseNumber } from '@lib/numbers';

/** The one selector convention of the app: `data-testid`, optionally narrowed by more attributes. */
function sel(testid: string, attrs = ''): string {
  return `[data-testid="${testid}"]${attrs}`;
}

/** The five numbers in the buy-list footer, parsed. */
export interface UiTotals {
  buyGold: number;
  feeGold: number;
  labor: number;
  laborGold: number;
  grandTotal: number;
}

/** One visible buy row as the table renders it, read in a single round trip. */
export interface UiBuyRow {
  itemId: number;
  name: string;
  qty: number;
  total: number;
}

export class CalculatorPage {
  readonly page: Page;

  // --- top bar ---------------------------------------------------------------------------------
  readonly searchInput: Locator;
  readonly searchPopup: Locator;
  readonly searchOptions: Locator;
  readonly qtyInput: Locator;
  readonly goldPerLaborInput: Locator;
  readonly profSelect: Locator;
  readonly profExact: Locator;
  readonly profExactToggle: Locator;
  readonly updatedStamp: Locator;
  readonly presetButtons: Locator;

  // --- page frame ------------------------------------------------------------------------------
  readonly rngNote: Locator;
  readonly status: Locator;
  readonly results: Locator;
  readonly targetLine: Locator;

  // --- craft tree ------------------------------------------------------------------------------
  readonly tree: Locator;
  readonly treeNodes: Locator;
  readonly expandAllButton: Locator;
  readonly collapseAllButton: Locator;

  // --- buy list --------------------------------------------------------------------------------
  readonly buyFilter: Locator;
  readonly buyRows: Locator;
  readonly visibleBuyRows: Locator;
  readonly buyEmpty: Locator;

  constructor(page: Page) {
    this.page = page;

    this.searchInput = this.id('search-input');
    this.searchPopup = this.id('search-popup');
    this.searchOptions = this.id('search-option');
    this.qtyInput = this.id('qty-input');
    this.goldPerLaborInput = this.id('gold-per-labor-input');
    this.profSelect = this.id('prof-select');
    this.profExact = this.id('prof-exact');
    this.profExactToggle = this.id('prof-exact-toggle');
    this.updatedStamp = this.id('updated-stamp');
    this.presetButtons = this.id('preset-button');

    this.rngNote = this.id('rng-note');
    this.status = this.id('status');
    this.results = this.id('results');
    this.targetLine = this.id('target-line');

    this.tree = this.id('tree');
    this.treeNodes = this.id('tree-node');
    this.expandAllButton = this.id('tree-expand-all');
    this.collapseAllButton = this.id('tree-collapse-all');

    this.buyFilter = this.id('buy-filter');
    this.buyRows = this.id('buy-row');
    this.visibleBuyRows = this.id('buy-row', ':not([hidden])');
    this.buyEmpty = this.id('buy-empty');
  }

  /** Every locator in this class starts here — the only place a `data-testid` is spelled out. */
  private id(testid: string, attrs = ''): Locator {
    return this.page.locator(sel(testid, attrs));
  }

  // ------------------------------------------------------------------------------- navigation

  /** Open the page and wait until `data.json` has been fetched and the boot render is done. */
  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.updatedStamp).not.toHaveText('…');
  }

  /** The suite's usual entry point: land on the page and load a preset's breakdown. */
  async openWithPreset(itemId: number): Promise<void> {
    await this.goto();
    await this.clickPreset(itemId);
  }

  // ----------------------------------------------------------------------------------- search

  /** Type into the item search, without waiting for anything (a no-match query opens no popup). */
  async typeInSearch(query: string): Promise<void> {
    await this.searchInput.fill(query);
  }

  /** Type into the item search and wait for the popup — for queries that do match something. */
  async searchFor(query: string): Promise<void> {
    await this.typeInSearch(query);
    await expect(this.searchPopup).toBeVisible();
  }

  /** The highlighted popup row — what ↑/↓ move and Enter picks. */
  get activeOption(): Locator {
    return this.id('search-option', '[aria-selected="true"]');
  }

  searchOption(itemId: number): Locator {
    return this.id('search-option', `[data-item-id="${itemId}"]`);
  }

  /** Item id of the highlighted popup row. */
  async activeOptionId(): Promise<number> {
    return Number(await this.activeOption.getAttribute('data-item-id'));
  }

  async pressInSearch(key: string): Promise<void> {
    await this.searchInput.press(key);
  }

  // --------------------------------------------------------------------------------- controls

  async setGoldPerLabor(value: number): Promise<void> {
    await this.goldPerLaborInput.fill(String(value));
  }

  /** Pick a proficiency discount from the preset list (0, 5, … 40). */
  async setProficiency(percent: number): Promise<void> {
    await this.profSelect.selectOption(String(percent));
  }

  /** Percentages the preset list offers, in render order. */
  async profOptionValues(): Promise<number[]> {
    return this.optionValues(this.profSelect);
  }

  /** Press "+" / "−": opens the exact-percent field over the list, or drops back to the list. */
  async toggleExactProficiency(): Promise<void> {
    await this.profExactToggle.click();
  }

  /** Open the exact field (if needed) and type a percentage the preset list does not offer. */
  async setExactProficiency(percent: number): Promise<void> {
    if (await this.profExact.isHidden()) await this.toggleExactProficiency();
    await this.profExact.fill(String(percent));
  }

  presetButton(itemId: number): Locator {
    return this.id('preset-button', `[data-item-id="${itemId}"]`);
  }

  /** Click a preset and wait for the results panel it paints — what it contains is the spec's job. */
  async clickPreset(itemId: number): Promise<void> {
    await this.presetButton(itemId).click();
    await expect(this.results).toBeVisible();
    await expect(this.targetLine).not.toBeEmpty();
  }

  /** `{itemId, qty}` a preset button promises to load — read off its data attributes. */
  async presetInputs(itemId: number): Promise<{ itemId: number; qty: number }> {
    const button = this.presetButton(itemId);
    return {
      itemId: Number(await button.getAttribute('data-item-id')),
      qty: Number(await button.getAttribute('data-qty')),
    };
  }

  // -------------------------------------------------------------------------------- craft tree

  /** First rendered node for an item (see the class note on repeated item ids). */
  treeNode(itemId: number): Locator {
    return this.id('tree-node', `[data-item-id="${itemId}"]`).first();
  }

  /** The same node, but only while the tree shows it in `mode` — assert it is visible. */
  treeNodeInMode(itemId: number, mode: 'craft' | 'buy'): Locator {
    return this.id('tree-node', `[data-item-id="${itemId}"][data-mode="${mode}"]`).first();
  }

  /** Item ids of the nodes currently in the tree — collapsing removes them, so this shrinks. */
  async renderedTreeNodeIds(): Promise<number[]> {
    const ids = await this.treeNodes.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset['itemId'] ?? ''),
    );
    return ids.map(Number);
  }

  /** A control in the node's OWN row — `> .node-row`, so a child node's controls never match. */
  private rowPart(itemId: number, testid: string): Locator {
    return this.treeNode(itemId).locator(`> .node-row ${sel(testid)}`);
  }

  /** The craft/buy buttons of a node. */
  nodeModeButton(itemId: number, mode: 'craft' | 'buy'): Locator {
    return this.rowPart(itemId, `node-mode-${mode}`);
  }

  /** "10x" beside a node's name — the batch size of the recipe it is crafted with. */
  batchTag(itemId: number): Locator {
    return this.rowPart(itemId, 'batch-tag');
  }

  /** The batch-yield line of a craft node — only rendered when one craft makes several units. */
  nodeYield(itemId: number): Locator {
    return this.rowPart(itemId, 'node-yield');
  }

  /** "+K spare" — the overshoot of a batch recipe, since whole crafts cannot be split. */
  surplusBadge(itemId: number): Locator {
    return this.nodeBadge(itemId, 'surplus');
  }

  /** The recipe `<select>` of a multi-recipe node — its value is the active recipe id. */
  recipeSelect(itemId: number): Locator {
    return this.rowPart(itemId, 'recipe-select');
  }

  /** Recipe ids the node's select offers, in render order. */
  async recipeOptionIds(itemId: number): Promise<number[]> {
    return this.optionValues(this.recipeSelect(itemId));
  }

  /** The numeric `value`s of a `<select>`'s options, in render order — the one place that cast lives. */
  private async optionValues(select: Locator): Promise<number[]> {
    const values = await select
      .locator('option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    return values.map(Number);
  }

  /** Pick a recipe for an item, by recipe id. */
  async chooseRecipe(itemId: number, recipeId: number): Promise<void> {
    await this.recipeSelect(itemId).selectOption(String(recipeId));
  }

  /** A node's own child list — `> `, because the descendants have `.node-children` of their own. */
  nodeChildren(itemId: number): Locator {
    return this.treeNode(itemId).locator('> .node-children');
  }

  private nodeBadge(itemId: number, kind: string): Locator {
    return this.rowPart(itemId, `badge-${kind}`);
  }

  /** "price set" — the item's unit price was typed in. Independent of the mode badge. */
  priceOverrideBadge(itemId: number): Locator {
    return this.nodeBadge(itemId, 'price-override');
  }

  /** "forced" — the craft/buy decision was overridden. Independent of the price badge. */
  modeForcedBadge(itemId: number): Locator {
    return this.nodeBadge(itemId, 'mode-forced');
  }

  /** Force a mode on an item; clicking the already-pressed button clears the override instead. */
  async forceMode(itemId: number, mode: 'craft' | 'buy'): Promise<void> {
    await this.nodeModeButton(itemId, mode).click();
  }

  /** Twisties in a given state — the tree's own signal that a bulk expand/collapse has landed. */
  private twisties(expanded: boolean): Locator {
    return this.id('tree-toggle', `[aria-expanded="${expanded}"]`);
  }

  async expandAll(): Promise<void> {
    await this.expandAllButton.click();
    await expect(this.twisties(false)).toHaveCount(0);
  }

  async collapseAll(): Promise<void> {
    await this.collapseAllButton.click();
    await expect(this.twisties(true)).toHaveCount(0);
  }

  // ---------------------------------------------------------------------------------- buy list

  buyRow(itemId: number): Locator {
    return this.id('buy-row', `[data-item-id="${itemId}"]`);
  }

  /** The row, but only while it carries the price-override flag — count it, do not read attributes. */
  overriddenRow(itemId: number): Locator {
    return this.id('buy-row', `[data-item-id="${itemId}"][data-overridden="true"]`);
  }

  priceInput(itemId: number): Locator {
    return this.buyRow(itemId).locator(sel('price-input'));
  }

  priceReset(itemId: number): Locator {
    return this.buyRow(itemId).locator(sel('price-reset'));
  }

  rowTotal(itemId: number): Locator {
    return this.buyRow(itemId).locator(sel('row-total'));
  }

  /**
   * Every visible row — id, name, quantity and total — in ONE round trip, in render order.
   * The buy list is a dozen-plus rows, and a per-row locator read each way is a dozen-plus of them.
   */
  async visibleBuyRowCells(): Promise<UiBuyRow[]> {
    const raw = await this.visibleBuyRows.evaluateAll(
      (rows, cell) =>
        rows.map((row) => ({
          itemId: (row as HTMLElement).dataset['itemId'] ?? '',
          name: row.querySelector('.item-name')?.textContent ?? '',
          qty: row.querySelector(cell.qty)?.textContent ?? '',
          total: row.querySelector(cell.total)?.textContent ?? '',
        })),
      { qty: sel('row-qty'), total: sel('row-total') },
    );
    return raw.map((cells) => ({
      itemId: Number(cells.itemId),
      name: cells.name,
      qty: parseNumber(cells.qty),
      total: parseNumber(cells.total),
    }));
  }

  /** `[itemId, name]` of every visible row — the filter matches on the name (and on the id). */
  async visibleBuyRowNames(): Promise<Array<{ itemId: number; name: string }>> {
    return (await this.visibleBuyRowCells()).map(({ itemId, name }) => ({ itemId, name }));
  }

  /** Item ids of the rows the user can currently see, in render order. */
  async visibleBuyRowIds(): Promise<number[]> {
    return (await this.visibleBuyRowNames()).map((row) => row.itemId);
  }

  async setFilter(text: string): Promise<void> {
    await this.buyFilter.fill(text);
  }

  /** Unit price as the row's input currently shows it. */
  async priceValue(itemId: number): Promise<number> {
    return parseNumber(await this.priceInput(itemId).inputValue());
  }

  async rowTotalValue(itemId: number): Promise<number> {
    return parseNumber(await this.rowTotal(itemId).textContent());
  }

  /**
   * Replace a row's unit price the way a user does: clear it, then press one key per character.
   * Every keystroke fires `input` -> a full recalc, so this is also the caret-survival probe.
   */
  async typePrice(itemId: number, value: string): Promise<void> {
    const input = this.priceInput(itemId);
    await input.click();
    await input.fill('');
    await input.pressSequentially(value);
  }

  // ------------------------------------------------------------------------------------ totals

  async totals(): Promise<UiTotals> {
    const read = async (testid: string): Promise<number> =>
      parseNumber(await this.id(testid).textContent());
    const [buyGold, feeGold, labor, laborGold, grandTotal] = await Promise.all([
      read('total-buy-gold'),
      read('total-fees'),
      read('total-labor'),
      read('total-labor-gold'),
      read('total-grand'),
    ]);
    return { buyGold, feeGold, labor, laborGold, grandTotal };
  }
}
