/**
 * price-edit.spec.ts — the editable unit price of a buy row.
 *
 * Every keystroke in a price field runs the whole engine again (`recalc({patchBuy:true})`), so this
 * spec covers both halves of that: the numbers must follow the engine with the override applied,
 * and the field must survive the repaint the recalc triggers under the user's caret.
 *
 * Subject: the first priced row of the preset's buy list, picked from the oracle. The typed price is
 * HALF the auction-house price — cheaper can only keep the item bought, so the row cannot vanish
 * mid-spec whatever data.json holds.
 */
import { test, expect } from '@lib/fixtures';
import { expectGold } from '@lib/numbers';
import { expected, mainPreset } from '@lib/oracle';

const preset = mainPreset();
const base = { target: preset.itemId, qty: preset.qty };

/** First row with a real auction-house price — a `no price` row has nothing to halve. */
function subject(): { itemId: number; name: string } {
  const row = expected(base).buyList.find((r) => !r.noPrice && r.unitPrice > 0);
  if (!row) throw new Error('no priced buy row in the preset breakdown');
  return { itemId: row.itemId, name: row.name };
}

test.describe('buy list — price editing', () => {
  test.beforeEach(async ({ calc }) => {
    await calc.goto();
    await calc.clickPreset(preset.itemId);
  });

  test('a typed price updates the row and the grand total, and keeps the caret', async ({ calc }) => {
    const { itemId, name } = subject();
    const shown = await calc.priceValue(itemId);
    // The input renders at most 4 decimals; halve what it shows, so the typed value is exact.
    const typed = String(Number((shown / 2).toFixed(4)));

    await expect(calc.buyRow(itemId)).not.toHaveAttribute('data-overridden', 'true');
    await expect(calc.priceReset(itemId)).toHaveCount(0);

    await calc.typePrice(itemId, typed);

    // Caret survival: the field the user was typing into is still focused and holds the whole value.
    expect(await calc.focusedItemId(), 'the edited price field kept focus').toBe(String(itemId));
    await expect(calc.priceInput(itemId)).toHaveValue(typed);

    // The row is flagged as overridden and offers a way back.
    await expect(calc.buyRow(itemId)).toHaveAttribute('data-overridden', 'true');
    await expect(calc.priceReset(itemId)).toBeVisible();

    // ...and every number on screen matches the engine run with that priceOverride.
    const want = expected({ ...base, priceOverride: { [itemId]: Number(typed) } });
    const wantRow = want.buyList.find((row) => row.itemId === itemId);
    expect(wantRow, `${name} is still bought at half price`).toBeDefined();
    expectGold(await calc.rowTotalValue(itemId), wantRow!.total, `row total for ${name}`);

    const totals = await calc.totals();
    expectGold(totals.buyGold, want.totals.buyGold, 'buy gold');
    expectGold(totals.grandTotal, want.totals.grandTotal, 'grand total');
    expect(totals.labor).toBe(want.totals.labor);
  });

  test('the reset button restores the auction-house price and the original totals', async ({ calc }) => {
    const { itemId } = subject();
    const original = await calc.priceInput(itemId).inputValue();
    const originalRowTotal = await calc.rowTotalValue(itemId);
    const originalTotals = await calc.totals();

    await calc.typePrice(itemId, String(Number((Number(original) / 2).toFixed(4))));
    expect(await calc.rowTotalValue(itemId)).toBeLessThan(originalRowTotal);

    await calc.priceReset(itemId).click();

    await expect(calc.priceInput(itemId)).toHaveValue(original);
    await expect(calc.buyRow(itemId)).not.toHaveAttribute('data-overridden', 'true');
    await expect(calc.priceReset(itemId)).toHaveCount(0);
    expect(await calc.totals(), 'clearing the override returns to the auction-house run').toEqual(
      originalTotals,
    );
  });
});
