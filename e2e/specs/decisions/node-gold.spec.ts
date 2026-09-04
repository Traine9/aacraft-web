/**
 * node-gold.spec.ts — every craft node must say what its branch costs in gold.
 *
 * A buy node states its money on its own detail line (`3 × 1.20g = 3.60g`), but a craft node's cost
 * is spread over its materials and their fees, all the way down — invisible without expanding the
 * whole subtree and adding it up by hand. `.node-gold` is that sum, over WHOLE crafts, so the
 * figure on the target is the bill the buy list foots.
 *
 * Deliberately NOT the number that decides craft vs buy: that comparison prices labor at the
 * gold-per-labor field, while the bill never charges for labor (SPEC, and `grandTotal` agrees).
 */
import { test, expect } from '@lib/fixtures';
import { expectGold, parseNumber } from '@lib/numbers';
import {
  craftNodeGolds,
  expected,
  laborProofCraft,
  mainPreset,
  mainPresetInputs,
} from '@lib/oracle';

const preset = mainPreset();
const base = mainPresetInputs();

test.describe('gold on a craft node', () => {
  test.beforeEach(async ({ calc }) => {
    await calc.openWithPreset(preset.itemId);
    await calc.expandAll();
  });

  test('every craft node prints its own branch cost, and no buy node repeats one', async ({
    calc,
  }) => {
    for (const node of craftNodeGolds(base)) {
      const shown = parseNumber(await calc.nodeGold(node.itemId).textContent());
      expectGold(shown, node.gold, `${node.name} (#${node.itemId}) branch gold`);
    }

    // Buy rows already carry `qty × price = total`; a second amount beside it would read as a
    // second charge.
    await expect(calc.buyNodeGolds).toHaveCount(0);
  });

  test('the figure on the target is the grand total, surplus and all', async ({ calc }) => {
    // The two are computed differently — the tree rounds crafts up per branch, `steps` rounds up
    // once over globally aggregated demand — so they part company if a crafted item appears in two
    // branches. No preset does that today; if one ever does, this is a data change, not a bug.
    const want = expected(base);
    const drift = Math.abs(want.tree.branchGold - want.totals.grandTotal);
    test.skip(drift > 0.005, 'a crafted item repeats across branches in this data — see SPEC');

    const shown = parseNumber(await calc.nodeGold(preset.itemId).textContent());
    const totals = await calc.totals();
    expectGold(shown, totals.grandTotal, 'the target node against the totals footer');
  });

  test('does not move when labor gets dearer — labor is priced, not billed', async ({ calc }) => {
    const proof = laborProofCraft(base);
    test.skip(!proof, 'no craft node survives a dearer labor price in this data');
    const { gpl, subject } = proof!;

    const before = parseNumber(await calc.nodeGold(subject.itemId).textContent());

    await calc.setGoldPerLabor(gpl);
    await calc.expandAll();
    const after = parseNumber(await calc.nodeGold(subject.itemId).textContent());

    expectGold(after, before, `${subject.name} (#${subject.itemId}) at ${gpl}g per labor`);
  });
});
