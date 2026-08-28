/**
 * presets.spec.ts — the one-click starting points (`src/presets.ts`).
 *
 * This is the suite's end-to-end oracle check: clicking the first preset must produce exactly the
 * buy list and the five totals that `src/engine.ts` computes for the same inputs over the same
 * data.json. Everything expected here is computed at runtime — no gold amount is written down.
 * (For the record, on the 2026-08-05 data set that is 13 rows, 16 742 labor and 21 126.36g.)
 */
import { test, expect } from '@lib/fixtures';
import { expectGold } from '@lib/numbers';
import { expected, mainPreset } from '@lib/oracle';

test.describe('presets', () => {
  const preset = mainPreset();

  test('the preset fills target and quantity from its own data attributes', async ({ calc }) => {
    await calc.goto();

    // The button advertises what it will load; the page must then actually load that.
    expect(await calc.presetInputs(preset.itemId)).toEqual({
      itemId: preset.itemId,
      qty: preset.qty,
    });

    await calc.clickPreset(preset.itemId);

    await expect(calc.qtyInput).toHaveValue(String(preset.qty));
    await expect(calc.targetLine).toContainText(`#${preset.itemId}`);
    await expect(calc.targetLine).toContainText(String(preset.qty));
    // Picking a preset also fills the search box with the item's name.
    await expect(calc.searchInput).not.toHaveValue('');
  });

  test('the buy list and totals reproduce the engine for the preset inputs', async ({ calc }) => {
    const want = expected({ target: preset.itemId, qty: preset.qty });
    expect(want.error, 'the preset target must be craftable').toBeUndefined();
    expect(want.buyList.length, 'the preset must produce a non-empty buy list').toBeGreaterThan(0);

    await calc.goto();
    await calc.clickPreset(preset.itemId);

    // Same rows, same order (buy list is sorted by total desc).
    await expect(calc.visibleBuyRows).toHaveCount(want.buyList.length);
    expect(await calc.visibleBuyRowIds()).toEqual(want.buyList.map((row) => row.itemId));

    // Every row: quantity is exact, the money is compared inside the display rounding.
    for (const row of want.buyList) {
      await expect(calc.rowQty(row.itemId)).toHaveText(row.qty.toLocaleString('en-US'));
      expectGold(await calc.rowTotalValue(row.itemId), row.total, `row total for ${row.name}`);
    }

    const totals = await calc.totals();
    expect(totals.labor, 'labor points are an integer count').toBe(want.totals.labor);
    expectGold(totals.buyGold, want.totals.buyGold, 'buy gold');
    expectGold(totals.feeGold, want.totals.feeGold, 'crafting fees');
    expectGold(totals.laborGold, want.totals.laborGold, 'labor -> gold');
    expectGold(totals.grandTotal, want.totals.grandTotal, 'grand total');
  });

  test('the craft tree opens on the target and its direct sub-crafts', async ({ calc }) => {
    const want = expected({ target: preset.itemId, qty: preset.qty });

    await calc.goto();
    await calc.clickPreset(preset.itemId);

    // SPEC: the target is always crafted, whatever the auction house says it costs.
    await expect(calc.treeNode(preset.itemId)).toHaveAttribute('data-mode', 'craft');
    for (const child of want.tree.children ?? []) {
      await expect(calc.treeNode(child.itemId)).toHaveAttribute('data-mode', child.mode);
    }

    // Collapse/expand are view-only: the totals must not move.
    const before = await calc.totals();
    await calc.collapseAll();
    await expect(calc.treeNodes).toHaveCount(1); // only the root survives a full collapse
    await calc.expandAll();
    expect(await calc.totals()).toEqual(before);
  });
});
