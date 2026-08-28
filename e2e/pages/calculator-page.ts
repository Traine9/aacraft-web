/**
 * calculator-page.ts — the one page object of the suite (the app is one page).
 *
 * CONVENTIONS (same as erp-test): a page object owns SELECTORS, NAVIGATION and typed READS of
 * on-screen state — it never asserts a business expectation. Specs compare its reads to the engine
 * oracle (`lib/oracle.ts`). No spec may contain a bare selector; every hook lives here.
 *
 * Two DOM facts the selectors below encode, because getting them wrong silently passes tests:
 *  - the buy-list filter HIDES rows (`[hidden]`) instead of removing them, so "visible rows" must be
 *    `buy-row:not([hidden])`, and `buy-empty` is always in the DOM;
 *  - an item id can appear at several places in the craft tree (the same material feeding two
 *    recipes). Mode is decided per ITEM, so all its nodes agree — `treeNode()` takes the first.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { parseNumber } from '@lib/numbers';

/** The five numbers in the buy-list footer, parsed. */
export interface UiTotals {
  buyGold: number;
  feeGold: number;
  labor: number;
  laborGold: number;
  grandTotal: number;
}

export class CalculatorPage {
  readonly page: Page;

  // --- top bar ---------------------------------------------------------------------------------
  readonly searchInput: Locator;
  readonly searchPopup: Locator;
  readonly searchOptions: Locator;
  readonly qtyInput: Locator;
  readonly goldPerLaborInput: Locator;
  readonly profCheckbox: Locator;
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
  readonly buyBody: Locator;
  readonly buyRows: Locator;
  readonly visibleBuyRows: Locator;
  readonly buyEmpty: Locator;

  constructor(page: Page) {
    this.page = page;
    const id = (testid: string): Locator => page.locator(`[data-testid="${testid}"]`);

    this.searchInput = id('search-input');
    this.searchPopup = id('search-popup');
    this.searchOptions = id('search-option');
    this.qtyInput = id('qty-input');
    this.goldPerLaborInput = id('gold-per-labor-input');
    this.profCheckbox = id('prof-checkbox');
    this.updatedStamp = id('updated-stamp');
    this.presetButtons = id('preset-button');

    this.rngNote = id('rng-note');
    this.status = id('status');
    this.results = id('results');
    this.targetLine = id('target-line');

    this.tree = id('tree');
    this.treeNodes = id('tree-node');
    this.expandAllButton = id('tree-expand-all');
    this.collapseAllButton = id('tree-collapse-all');

    this.buyFilter = id('buy-filter');
    this.buyBody = id('buy-body');
    this.buyRows = id('buy-row');
    this.visibleBuyRows = page.locator('[data-testid="buy-row"]:not([hidden])');
    this.buyEmpty = id('buy-empty');
  }

  // ------------------------------------------------------------------------------- navigation

  /** Open the page and wait until `data.json` has been fetched and the boot render is done. */
  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.updatedStamp).not.toHaveText('…');
  }

  // ----------------------------------------------------------------------------------- search

  /** Type into the item search and wait for the popup (a query with no match leaves it hidden). */
  async searchFor(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await expect(this.searchPopup).toBeVisible();
  }

  /** The highlighted popup row — what ↑/↓ move and Enter picks. */
  get activeOption(): Locator {
    return this.page.locator('[data-testid="search-option"][aria-selected="true"]');
  }

  searchOption(itemId: number): Locator {
    return this.page.locator(`[data-testid="search-option"][data-item-id="${itemId}"]`);
  }

  /** Item id of the highlighted popup row. */
  async activeOptionId(): Promise<number> {
    return Number(await this.activeOption.getAttribute('data-item-id'));
  }

  async pressInSearch(key: string): Promise<void> {
    await this.searchInput.press(key);
  }

  // --------------------------------------------------------------------------------- controls

  /** Set the quantity field. `fill` fires `input`, which is what triggers the recalc. */
  async setQty(qty: number): Promise<void> {
    await this.qtyInput.fill(String(qty));
  }

  async setGoldPerLabor(value: number): Promise<void> {
    await this.goldPerLaborInput.fill(String(value));
  }

  async setProficiency(on: boolean): Promise<void> {
    await this.profCheckbox.setChecked(on);
  }

  presetButton(itemId: number): Locator {
    return this.page.locator(`[data-testid="preset-button"][data-item-id="${itemId}"]`);
  }

  /** Click a preset and wait for its breakdown to be on screen. */
  async clickPreset(itemId: number): Promise<void> {
    await this.presetButton(itemId).click();
    await expect(this.results).toBeVisible();
    await expect(this.visibleBuyRows.first()).toBeVisible();
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
    return this.page.locator(`[data-testid="tree-node"][data-item-id="${itemId}"]`).first();
  }

  /** `craft` or `buy`, as the tree currently shows it. */
  async nodeMode(itemId: number): Promise<string | null> {
    return this.treeNode(itemId).getAttribute('data-mode');
  }

  /** The craft/buy buttons of a node — scoped to its own row so a child's buttons never match. */
  nodeModeButton(itemId: number, mode: 'craft' | 'buy'): Locator {
    return this.treeNode(itemId).locator(`> .node-row [data-testid="node-mode-${mode}"]`);
  }

  /** A node's own child list — `> `, because the descendants have `.node-children` of their own. */
  nodeChildren(itemId: number): Locator {
    return this.treeNode(itemId).locator('> .node-children');
  }

  /** Badges on a node's own row (`forced`, `price set`, `no price`, `cycle → buy`). */
  nodeBadge(itemId: number, kind: string): Locator {
    return this.treeNode(itemId).locator(`> .node-row [data-testid="badge-${kind}"]`);
  }

  /** Force a mode on an item; clicking the already-pressed button clears the override instead. */
  async forceMode(itemId: number, mode: 'craft' | 'buy'): Promise<void> {
    await this.nodeModeButton(itemId, mode).click();
  }

  async expandAll(): Promise<void> {
    await this.expandAllButton.click();
  }

  async collapseAll(): Promise<void> {
    await this.collapseAllButton.click();
  }

  // ---------------------------------------------------------------------------------- buy list

  buyRow(itemId: number): Locator {
    return this.page.locator(`[data-testid="buy-row"][data-item-id="${itemId}"]`);
  }

  priceInput(itemId: number): Locator {
    return this.buyRow(itemId).locator('[data-testid="price-input"]');
  }

  priceReset(itemId: number): Locator {
    return this.buyRow(itemId).locator('[data-testid="price-reset"]');
  }

  rowTotal(itemId: number): Locator {
    return this.buyRow(itemId).locator('[data-testid="row-total"]');
  }

  rowQty(itemId: number): Locator {
    return this.buyRow(itemId).locator('[data-testid="row-qty"]');
  }

  /** Item ids of the rows the user can currently see, in render order. */
  async visibleBuyRowIds(): Promise<number[]> {
    const ids = await this.visibleBuyRows.evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset['itemId'] ?? ''),
    );
    return ids.map(Number);
  }

  /** `[itemId, name]` of every visible row — the filter matches on the name (and on the id). */
  async visibleBuyRowNames(): Promise<Array<{ itemId: number; name: string }>> {
    return this.visibleBuyRows.evaluateAll((rows) =>
      rows.map((row) => ({
        itemId: Number((row as HTMLElement).dataset['itemId']),
        name: row.querySelector('.item-name')?.textContent ?? '',
      })),
    );
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
    for (const char of value) await this.page.keyboard.press(char);
  }

  /** `data-item-id` of the focused element, or null — proves an edit kept its field focused. */
  async focusedItemId(): Promise<string | null> {
    return this.page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset['itemId'] ?? null,
    );
  }

  // ------------------------------------------------------------------------------------ totals

  async totals(): Promise<UiTotals> {
    const read = async (testid: string): Promise<number> =>
      parseNumber(await this.page.locator(`[data-testid="${testid}"]`).textContent());
    return {
      buyGold: await read('total-buy-gold'),
      feeGold: await read('total-fees'),
      labor: await read('total-labor'),
      laborGold: await read('total-labor-gold'),
      grandTotal: await read('total-grand'),
    };
  }
}
