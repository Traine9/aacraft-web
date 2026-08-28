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
import { firstPricedBuyRow, expected, mainPreset, mainPresetInputs } from '@lib/oracle';
import { priceInputValue } from '../../../src/ui/dom';

const preset = mainPreset();
const base = mainPresetInputs();
const { itemId, name } = firstPricedBuyRow(base);

test.describe('buy list — price editing', () => {
  test.beforeEach(async ({ calc }) => {
    await calc.openWithPreset(preset.itemId);
  });

  test('a typed price updates the row and the grand total, and keeps the caret', async ({ calc }) => {
    // The input renders at most 4 decimals; halve what it shows, so the typed value is exact.
    const typed = priceInputValue((await calc.priceValue(itemId)) / 2);

    await expect(calc.overriddenRow(itemId)).toHaveCount(0);
    await expect(calc.priceReset(itemId)).toHaveCount(0);

    await calc.typePrice(itemId, typed);

    // Caret survival: the field the user was typing into is still focused and holds the whole value.
    await expect(calc.priceInput(itemId), 'the edited price field kept focus').toBeFocused();
    await expect(calc.priceInput(itemId)).toHaveValue(typed);

    // The row is flagged as overridden and offers a way back.
    await expect(calc.overriddenRow(itemId)).toHaveCount(1);
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
    const original = await calc.priceInput(itemId).inputValue();
    const originalRowTotal = await calc.rowTotalValue(itemId);
    const originalTotals = await calc.totals();

    await calc.typePrice(itemId, priceInputValue(Number(original) / 2));
    expect(await calc.rowTotalValue(itemId)).toBeLessThan(originalRowTotal);

    await calc.priceReset(itemId).click();

    await expect(calc.priceInput(itemId)).toHaveValue(original);
    await expect(calc.overriddenRow(itemId)).toHaveCount(0);
    await expect(calc.priceReset(itemId)).toHaveCount(0);
    expect(await calc.totals(), 'clearing the override returns to the auction-house run').toEqual(
      originalTotals,
    );
  });
});
