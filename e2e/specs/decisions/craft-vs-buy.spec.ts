/**
 * craft-vs-buy.spec.ts — the three inputs that move the craft/buy decision.
 *
 *  1. gold per labor — the price of the labor a craft burns. Raise it far enough and a crafted
 *     material becomes cheaper to buy: the node flips and the labor total falls.
 *  2. proficiency — 0 % means full labor cost on every craft, so the labor total rises.
 *  3. the per-node craft/buy toggle — forces one item, collapsing its subtree into the buy list;
 *     pressing the same button again returns the item to the automatic decision.
 *
 * Every subject (which item flips, at which labor price, which node to force) is picked from the
 * engine at runtime by `lib/oracle.ts`, so nothing here depends on today's auction-house prices.
 */
import { test, expect } from '@lib/fixtures';
import { expectGold } from '@lib/numbers';
import {
  expected,
  findFlipAtSomeGpl,
  firstForcibleSubCraft,
  mainPreset,
  mainPresetInputs,
  UI_PROF_PERCENT,
} from '@lib/oracle';

const preset = mainPreset();
const base = mainPresetInputs();

test.describe('craft-vs-buy decisions', () => {
  test.beforeEach(async ({ calc }) => {
    await calc.openWithPreset(preset.itemId);
  });

  test('raising gold per labor flips a crafted item to bought and drops the labor total', async ({
    calc,
  }) => {
    // The cheapest labor price that actually flips something, and the shallowest node it flips.
    const found = findFlipAtSomeGpl(base);
    expect(found, 'no gold-per-labor value in range flips any node of the preset').not.toBeNull();
    const { gpl, flip } = found!;

    await calc.expandAll();
    await expect(calc.treeNodeInMode(flip.itemId, 'craft'), `${flip.name} starts out crafted`).toBeVisible();
    const before = await calc.totals();

    await calc.setGoldPerLabor(gpl);
    await calc.expandAll();

    await expect(calc.treeNodeInMode(flip.itemId, 'buy'), `${flip.name} flips to buy`).toBeVisible();

    const want = expected({ ...base, goldPerLabor: gpl });
    const after = await calc.totals();
    expect(after.labor, 'buying instead of crafting saves labor').toBeLessThan(before.labor);
    expect(after.labor).toBe(want.totals.labor);
    expectGold(after.grandTotal, want.totals.grandTotal, 'grand total at the higher labor price');
    expectGold(after.buyGold, want.totals.buyGold, 'buy gold at the higher labor price');
  });

  test('dropping proficiency to 0% raises the labor total', async ({ calc }) => {
    const before = await calc.totals();

    await calc.setProficiency(0);

    const want = expected({ ...base, profPercent: 0 });
    const after = await calc.totals();
    expect(after.labor, 'no proficiency discount means more labor').toBeGreaterThan(before.labor);
    expect(after.labor).toBe(want.totals.labor);
    expectGold(after.grandTotal, want.totals.grandTotal, 'grand total without proficiency');

    // ...and back: the selector is not one-way.
    await calc.setProficiency(UI_PROF_PERCENT);
    expect(await calc.totals()).toEqual(before);
  });

  test('forcing buy on a node collapses its subtree into the buy list, and a second click clears it', async ({
    calc,
  }) => {
    const { itemId } = firstForcibleSubCraft(base);

    await calc.expandAll();
    await expect(calc.treeNodeInMode(itemId, 'craft')).toBeVisible();
    await expect(calc.nodeChildren(itemId), 'it starts out expanded, with materials').toHaveCount(1);
    await expect(calc.buyRow(itemId), 'a crafted item is not on the buy list').toHaveCount(0);
    const before = await calc.totals();

    await calc.forceMode(itemId, 'buy');

    // The node is bought now, says so, and has no children left to show.
    await expect(calc.treeNodeInMode(itemId, 'buy')).toBeVisible();
    await expect(calc.modeForcedBadge(itemId)).toBeVisible();
    await expect(calc.nodeModeButton(itemId, 'buy')).toHaveAttribute('aria-pressed', 'true');
    await expect(calc.nodeChildren(itemId), 'a bought node has no subtree').toHaveCount(0);

    // Its materials left the buy list and the item itself joined it, exactly as the engine says.
    const want = expected({ ...base, modeOverride: { [itemId]: 'buy' } });
    await expect(calc.buyRow(itemId)).toBeVisible();
    await expect(calc.visibleBuyRows).toHaveCount(want.buyList.length);
    expect(await calc.visibleBuyRowIds()).toEqual(want.buyList.map((row) => row.itemId));

    const after = await calc.totals();
    expect(after.labor, 'not crafting it saves its labor').toBeLessThan(before.labor);
    expect(after.labor).toBe(want.totals.labor);
    expectGold(after.grandTotal, want.totals.grandTotal, 'grand total with the forced buy');

    // Clicking the pressed button again returns the item to the automatic decision. Only the MODE
    // badge must go: a price badge on the same node is a different override entirely.
    await calc.forceMode(itemId, 'buy');
    await expect(calc.treeNodeInMode(itemId, 'craft')).toBeVisible();
    await expect(calc.modeForcedBadge(itemId)).toHaveCount(0);
    await expect(calc.buyRow(itemId)).toHaveCount(0);
    expect(await calc.totals()).toEqual(before);
  });
});
