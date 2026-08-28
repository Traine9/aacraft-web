/**
 * Buy-list table body: filterable rows with live-editable unit prices.
 *
 * Painting only — every event is handled by the delegated listeners `main.ts` wires on the tbody,
 * which find their item id on the `data-item-id` of the input / button that was clicked.
 */
import type { BuyRow } from '../engine';
import { badge, clear, el, gold, int, priceInputValue, setFlags } from './dom';

/** Test id of the editable unit-price inputs — the anchor for delegation and focus checks. */
export const PRICE_INPUT = 'price-input';
/** Test id of the "back to the AH price" button that appears on an overridden row. */
export const PRICE_RESET = 'price-reset';

export function isPriceInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.dataset['testid'] === PRICE_INPUT;
}

/** True while the user is typing into a price field — the table must not be rebuilt under them. */
export function isEditingPrice(): boolean {
  return isPriceInput(document.activeElement);
}

/** Filter key of a row: its name and its id, both searchable. */
interface RowKey {
  name: string;
  itemId: number;
}

export function matchesFilter(row: RowKey, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return row.name.toLowerCase().includes(q) || String(row.itemId).includes(q);
}

/**
 * View-only: hide the rows that do not match, show the right empty message. Never touches the
 * engine, so typing in the filter leaves the craft tree (and its scroll position) alone.
 */
export function applyFilter(tbody: HTMLTableSectionElement, filter: string): void {
  let rows = 0;
  let visible = 0;
  for (const tr of tbody.querySelectorAll<HTMLTableRowElement>('tr[data-item-id]')) {
    rows++;
    // The rendered row is the filter key: its name is right there in the cell.
    const key: RowKey = {
      name: tr.querySelector('.item-name')?.textContent ?? '',
      itemId: Number(tr.dataset['itemId']),
    };
    tr.hidden = !matchesFilter(key, filter);
    if (!tr.hidden) visible++;
  }

  const empty = tbody.querySelector<HTMLTableRowElement>('[data-testid="buy-empty"]');
  if (!empty) return;
  empty.hidden = visible > 0;
  const cell = empty.firstElementChild;
  if (cell) {
    cell.textContent =
      rows === 0 ? 'Nothing to buy — every material is crafted.' : 'No item matches the filter.';
  }
}

/** Add or remove a single child, identified by its test id. Idempotent — safe on every patch. */
function toggleChild(parent: Element, testid: string, on: boolean, make: () => HTMLElement): void {
  const existing = parent.querySelector(`[data-testid="${testid}"]`);
  if (on && !existing) parent.appendChild(make());
  else if (!on && existing) existing.remove();
}

/** qty 0 = an override pushed the item out of the buy list; the row is kept so it stays editable. */
function markRow(tr: HTMLTableRowElement, row: BuyRow): void {
  const dropped = row.qty === 0;
  setFlags(tr, { overridden: row.overridden, dropped, noprice: row.noPrice });

  const name = tr.querySelector('.cell-name');
  if (name) {
    toggleChild(name, 'badge-noprice', row.noPrice, () => badge('noprice', 'no price'));
    toggleChild(name, 'badge-dropped', dropped, () => badge('dropped', 'not bought'));
  }

  const cell = tr.querySelector('.cell-price');
  if (cell) toggleChild(cell, PRICE_RESET, row.overridden, () => resetButton(row));
}

function resetButton(row: BuyRow): HTMLButtonElement {
  return el('button', {
    className: 'reset-btn',
    text: '⟲',
    testid: PRICE_RESET,
    attrs: {
      type: 'button',
      title: 'Reset to the auction-house price',
      'aria-label': `Reset price for ${row.name}`,
      'data-item-id': String(row.itemId),
    },
  });
}

function setCell(tr: HTMLTableRowElement, testid: string, text: string): void {
  const cell = tr.querySelector(`[data-testid="${testid}"]`);
  if (cell) cell.textContent = text;
}

/** Full rebuild: rows, order and filtering. Used whenever no price field is being typed into. */
export function renderBuyList(
  tbody: HTMLTableSectionElement,
  rows: readonly BuyRow[],
  filter: string,
): void {
  clear(tbody);

  for (const row of rows) {
    const input = el('input', {
      className: 'price-input',
      testid: PRICE_INPUT,
      attrs: {
        type: 'number',
        min: '0',
        step: 'any',
        value: priceInputValue(row.unitPrice),
        'data-item-id': String(row.itemId),
        'aria-label': `Unit price for ${row.name}`,
      },
    });

    const tr = el('tr', {
      testid: 'buy-row',
      attrs: { 'data-item-id': String(row.itemId) },
      children: [
        el('td', {
          className: 'cell-name',
          children: [
            el('span', { className: 'item-name', text: row.name }),
            el('span', { className: 'item-id', text: `#${row.itemId}` }),
          ],
        }),
        el('td', { className: 'num', text: int(row.qty), testid: 'row-qty' }),
        el('td', { className: 'cell-price', children: [input] }),
        el('td', { className: 'num', text: gold(row.total), testid: 'row-total' }),
      ],
    });
    markRow(tr, row);
    tbody.appendChild(tr);
  }

  // Always present, shown by `applyFilter` when nothing is visible.
  tbody.appendChild(
    el('tr', {
      testid: 'buy-empty',
      children: [el('td', { className: 'empty', attrs: { colspan: '4' } })],
    }),
  );
  applyFilter(tbody, filter);
}

/**
 * Numbers-only update, used while a price field has focus: quantities, totals and override marks
 * are refreshed in place, but no row is created, moved or removed — recreating the focused
 * `<input type="number">` would lose the caret (Chrome has no selection API for number inputs).
 * The next full render (on blur, or any other control) re-sorts and re-filters the table.
 */
export function patchBuyList(tbody: HTMLTableSectionElement, rows: readonly BuyRow[]): void {
  const byId = new Map(rows.map((row) => [row.itemId, row]));
  for (const tr of tbody.querySelectorAll<HTMLTableRowElement>('tr[data-item-id]')) {
    const row = byId.get(Number(tr.dataset['itemId']));
    // Gone from the result: it is crafted now (or its consumer flipped). Dim it and zero it; the
    // rebuild on blur brings it back as a proper row (see `withOverrideRows` in main.ts).
    if (!row) {
      setCell(tr, 'row-qty', int(0));
      setCell(tr, 'row-total', gold(0));
      setFlags(tr, { dropped: true });
      continue;
    }

    setCell(tr, 'row-qty', int(row.qty));
    setCell(tr, 'row-total', gold(row.total));
    const input = tr.querySelector<HTMLInputElement>(`[data-testid="${PRICE_INPUT}"]`);
    if (input && document.activeElement !== input) input.value = priceInputValue(row.unitPrice);
    markRow(tr, row);
  }
}
