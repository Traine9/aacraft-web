/** Buy-list table body: filterable rows with live-editable unit prices. */
import type { BuyRow } from '../engine';
import { clear, el, gold, int, priceInputValue } from './dom';

export interface BuyListHandlers {
  /** Raw input text; empty means "drop the override and go back to the AH price". */
  onPriceInput: (itemId: number, raw: string) => void;
  onPriceReset: (itemId: number) => void;
  /** The user left a price field — safe to rebuild (re-sort) the table again. */
  onPriceCommit: () => void;
}

export function matchesFilter(row: BuyRow, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return row.name.toLowerCase().includes(q) || String(row.itemId).includes(q);
}

/** qty 0 = an override pushed the item out of the buy list; the row is kept so it stays editable. */
function markRow(tr: HTMLTableRowElement, row: BuyRow, h: BuyListHandlers): void {
  const dropped = row.qty === 0;
  tr.classList.toggle('row-overridden', row.overridden);
  tr.classList.toggle('row-dropped', dropped);
  toggleAttr(tr, 'data-overridden', row.overridden);
  toggleAttr(tr, 'data-dropped', dropped);
  toggleAttr(tr, 'data-noprice', row.noPrice);

  const name = tr.querySelector('.cell-name');
  if (name) {
    toggleBadge(name, 'badge-noprice', 'no price', row.noPrice);
    toggleBadge(name, 'badge-dropped', 'not bought', dropped);
  }

  const cell = tr.querySelector('.cell-price');
  const existing = cell?.querySelector<HTMLButtonElement>('[data-testid="price-reset"]');
  if (row.overridden && cell && !existing) cell.appendChild(resetButton(row, h));
  else if (!row.overridden && existing) existing.remove();
}

function toggleAttr(node: Element, name: string, on: boolean): void {
  if (on) node.setAttribute(name, 'true');
  else node.removeAttribute(name);
}

function toggleBadge(parent: Element, className: string, text: string, on: boolean): void {
  const existing = parent.querySelector(`.${className}`);
  if (on && !existing) parent.appendChild(el('span', { className: `badge ${className}`, text }));
  else if (!on && existing) existing.remove();
}

function resetButton(row: BuyRow, h: BuyListHandlers): HTMLButtonElement {
  const btn = el('button', {
    className: 'reset-btn',
    text: '⟲',
    testid: 'price-reset',
    attrs: {
      type: 'button',
      title: 'Reset to the auction-house price',
      'aria-label': `Reset price for ${row.name}`,
      'data-item-id': String(row.itemId),
    },
  });
  btn.addEventListener('click', () => h.onPriceReset(row.itemId));
  return btn;
}

/** Full rebuild: rows, order and filtering. Used whenever no price field is being typed into. */
export function renderBuyList(
  tbody: HTMLTableSectionElement,
  rows: readonly BuyRow[],
  filter: string,
  h: BuyListHandlers,
): void {
  clear(tbody);

  const visible = rows.filter((row) => matchesFilter(row, filter));
  if (visible.length === 0) {
    const cell = el('td', {
      className: 'empty',
      text:
        rows.length === 0 ? 'Nothing to buy — every material is crafted.' : 'No item matches the filter.',
      attrs: { colspan: '4' },
    });
    tbody.appendChild(el('tr', { testid: 'buy-empty', children: [cell] }));
    return;
  }

  for (const row of visible) {
    const input = el('input', {
      className: 'price-input',
      testid: 'price-input',
      attrs: {
        type: 'number',
        min: '0',
        step: 'any',
        value: priceInputValue(row.unitPrice),
        'data-item-id': String(row.itemId),
        'aria-label': `Unit price for ${row.name}`,
      },
    });
    input.addEventListener('input', () => h.onPriceInput(row.itemId, input.value));
    // Leaving the field is the moment the table may safely re-sort / drop rows again.
    input.addEventListener('blur', () => h.onPriceCommit());

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
    markRow(tr, row, h);
    tbody.appendChild(tr);
  }
}

/**
 * Numbers-only update, used while a price field has focus: quantities, totals and override marks
 * are refreshed in place, but no row is created, moved or removed — recreating the focused
 * `<input type="number">` would lose the caret (Chrome has no selection API for number inputs).
 * The next full render (on blur, or any other control) re-sorts and re-filters the table.
 */
export function patchBuyList(
  tbody: HTMLTableSectionElement,
  rows: readonly BuyRow[],
  h: BuyListHandlers,
): void {
  const byId = new Map(rows.map((row) => [row.itemId, row]));
  for (const tr of tbody.querySelectorAll<HTMLTableRowElement>('tr[data-item-id]')) {
    const itemId = Number(tr.dataset['itemId']);
    const input = tr.querySelector<HTMLInputElement>('[data-testid="price-input"]');
    const fresh = byId.get(itemId);
    // Gone from the result: it is crafted now (or its consumer flipped) — show it as not bought.
    const row: BuyRow = fresh ?? {
      itemId,
      name: tr.querySelector('.item-name')?.textContent ?? `Item ${itemId}`,
      qty: 0,
      unitPrice: Number(input?.value ?? 0),
      total: 0,
      noPrice: false,
      overridden: tr.dataset['overridden'] === 'true',
    };

    const qtyCell = tr.querySelector('[data-testid="row-qty"]');
    if (qtyCell) qtyCell.textContent = int(row.qty);
    const totalCell = tr.querySelector('[data-testid="row-total"]');
    if (totalCell) totalCell.textContent = gold(row.total);
    if (input && document.activeElement !== input) input.value = priceInputValue(row.unitPrice);
    markRow(tr, row, h);
  }
}
