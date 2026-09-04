/**
 * batch-yield.spec.ts — a craft node must say how many units one craft makes.
 *
 * Many recipes are batches: the "Fast/Ultrafast Batch Processing" variants make 10 or 100 units at
 * a time, and the engine defaults to the biggest batch. Without the yield on screen the buy list
 * is inexplicable — one craft of Kraken's Might buys reagents for a hundred of them — and the
 * overshoot (whole crafts cannot be split, so the surplus is paid for in full) is invisible.
 *
 * The subject node is picked from the engine at runtime by `lib/oracle.ts`.
 */
import { test, expect } from '@lib/fixtures';
import { batchTarget, firstBatchCraft, mainPreset, mainPresetInputs } from '@lib/oracle';

const preset = mainPreset();
const base = mainPresetInputs();
const subject = firstBatchCraft(base);

test.describe('batch recipe yield', () => {
  test.beforeEach(async ({ calc }) => {
    await calc.openWithPreset(preset.itemId);
    await calc.expandAll();
  });

  test('a batch craft node tags its name with the batch size and states what it adds up to', async ({
    calc,
  }) => {
    const produced = subject.crafts * subject.outAmount;
    await expect(
      calc.batchTag(subject.itemId),
      `${subject.name} is made ${subject.outAmount} at a time`,
    ).toHaveText(`${subject.outAmount.toLocaleString('en-US')}x`);
    await expect(calc.nodeYield(subject.itemId)).toHaveText(
      `→ ${produced.toLocaleString('en-US')} for ${subject.needed.toLocaleString('en-US')} needed`,
    );
  });

  test('the overshoot of a batch craft is flagged, and a x1 recipe has neither line', async ({
    calc,
  }) => {
    const spare = subject.crafts * subject.outAmount - subject.needed;
    const badge = calc.surplusBadge(subject.itemId);
    if (spare > 0) await expect(badge).toHaveText(`+${spare.toLocaleString('en-US')} spare`);
    else await expect(badge, 'a batch that comes out even wastes nothing').toHaveCount(0);

    // The target is crafted one at a time in every preset, so it carries neither marker.
    await expect(calc.nodeYield(preset.itemId)).toHaveCount(0);
    await expect(calc.batchTag(preset.itemId)).toHaveCount(0);
    await expect(calc.surplusBadge(preset.itemId)).toHaveCount(0);
  });
});

test.describe('a batch-crafted target', () => {
  const target = batchTarget();

  test('carries its batch size in the heading, not just in the tree', async ({ calc }) => {
    await calc.openByName(target.name, target.itemId);

    // "1 × Alluvion Love 10x (#42045)" — asking for one when the recipe makes ten must say so up
    // top, where the preset heading is the only thing naming the item.
    await expect(calc.targetLine).toHaveText(
      `1 × ${target.name} ${target.outAmount.toLocaleString('en-US')}x (#${target.itemId})`,
    );
    await expect(calc.batchTag(target.itemId)).toHaveText(
      `${target.outAmount.toLocaleString('en-US')}x`,
    );
  });
});
