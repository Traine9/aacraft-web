/**
 * craft-vs-buy.spec.ts — the three inputs that move the craft/buy decision.
 *
 *  1. gold per labor — the price of the labor a craft burns. Raise it far enough and a crafted
 *     material becomes cheaper to buy: the node flips and the labor total falls.
 *  2. max proficiency — off means full labor cost on every craft, so the labor total rises.
 *  3. the per-node craft/buy toggle — forces one item, collapsing its subtree into the buy list;
 *     pressing the same button again returns the item to the automatic decision.
 *
 * Every subject (which item flips, which node to force) is picked from the engine at runtime, so
 * nothing here depends on today's auction-house prices.
 */
import { test, expect } from '@lib/fixtures';
import { expectGold } from '@lib/numbers';
import { expected, findFlip, mainPreset, UI_DEFAULTS } from '@lib/oracle';

const preset = mainPreset();
const base = { target: preset.itemId, qty: preset.qty };

/** Gold-per-labor values to try, cheapest first: the flip spec uses the first one that flips a node. */
const HIGHER_GPL = [0.5, 1, 2, 5, 10];

test.describe('craft-vs-buy decisions', () => {
  test.beforeEach(async ({ calc }) => {
    await calc.goto();
    await calc.clickPreset(preset.itemId);
  });

  test('raising gold per labor flips a crafted item to bought and drops the labor total', async ({
    calc,
  }) => {
    // Pick the cheapest labor price that actually flips something, and the shallowest node it flips.
    const found = HIGHER_GPL.map((gpl) => ({ gpl, flip: findFlip(base, UI_DEFAULTS.goldPerLabor, gpl) })).find(
      (candidate) => candidate.flip !== null,
    );
    expect(found, 'no gold-per-labor value in range flips any node of the preset').toBeDefined();
    const { gpl } = found!;
    const flip = found!.flip!;

    await calc.expandAll();
    await expect(calc.treeNode(flip.itemId), `${flip.name} starts out crafted`).toHaveAttribute(
      'data-mode',
      'craft',
    );
    const before = await calc.totals();

    await calc.setGoldPerLabor(gpl);
    await calc.expandAll();

    await expect(calc.treeNode(flip.itemId), `${flip.name} flips to buy`).toHaveAttribute(
      'data-mode',
      'buy',
    );

    const want = expected({ ...base, goldPerLabor: gpl });
    const after = await calc.totals();
    expect(after.labor, 'buying instead of crafting saves labor').toBeLessThan(before.labor);
    expect(after.labor).toBe(want.totals.labor);
    expectGold(after.grandTotal, want.totals.grandTotal, 'grand total at the higher labor price');
    expectGold(after.buyGold, want.totals.buyGold, 'buy gold at the higher labor price');
  });

  test('turning max proficiency off raises the labor total', async ({ calc }) => {
    const before = await calc.totals();

    await calc.setProficiency(false);

    const want = expected({ ...base, profReduction: false });
    const after = await calc.totals();
    expect(after.labor, 'no proficiency discount means more labor').toBeGreaterThan(before.labor);
    expect(after.labor).toBe(want.totals.labor);
    expectGold(after.grandTotal, want.totals.grandTotal, 'grand total without proficiency');

    // ...and back: the checkbox is not one-way.
    await calc.setProficiency(true);
    expect(await calc.totals()).toEqual(before);
  });

  test('forcing buy on a node collapses its subtree into the buy list, and a second click clears it', async ({
    calc,
  }) => {
    // A crafted, priced sub-craft directly under the target: forcing it to buy must add a buy row.
    const auto = expected(base);
    const forcedItem = (auto.tree.children ?? []).find(
      (child) => child.mode === 'craft' && child.unitPrice !== null,
    );
    expect(forcedItem, 'the preset must have a priced sub-craft to force').toBeDefined();
    const itemId = forcedItem!.itemId;

    await calc.expandAll();
    await expect(calc.treeNode(itemId)).toHaveAttribute('data-mode', 'craft');
    await expect(calc.nodeChildren(itemId), 'it starts out expanded, with materials').toHaveCount(1);
    await expect(calc.buyRow(itemId), 'a crafted item is not on the buy list').toHaveCount(0);
    const before = await calc.totals();

    await calc.forceMode(itemId, 'buy');

    // The node is bought now, says so, and has no children left to show.
    await expect(calc.treeNode(itemId)).toHaveAttribute('data-mode', 'buy');
    await expect(calc.nodeBadge(itemId, 'override')).toHaveText('forced');
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

    // Clicking the pressed button again returns the item to the automatic decision.
    await calc.forceMode(itemId, 'buy');
    await expect(calc.treeNode(itemId)).toHaveAttribute('data-mode', 'craft');
    await expect(calc.nodeBadge(itemId, 'override')).toHaveCount(0);
    await expect(calc.buyRow(itemId)).toHaveCount(0);
    expect(await calc.totals()).toEqual(before);
  });
});
