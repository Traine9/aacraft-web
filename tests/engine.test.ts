import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildIndex,
  calculate,
  clampProfPercent,
  DEFAULT_PROF_PERCENT,
  effectiveLabor,
  type BuyRow,
  type CalcOptions,
  type CalcResult,
  type CraftIndex,
  type DataSet,
  type Recipe,
  type Step,
} from '../src/engine.js';

/**
 * Synthetic fixture — a 3-level sealed-armour style chain plus shared raw mats.
 *
 *   1 Ayanad Robe      r101  labor 100  fee 1.5   <- 1x Delphinad, 2x Wisp
 *   2 Delphinad Robe   r102  labor  50  fee 0.5   <- 1x Magnificent, 2x Wisp, 1x Cloth
 *                      r106  labor  80  fee 0.2   <- 1x Magnificent, 10x Sand   (alt recipe)
 *   4 Magnificent Robe r103  labor  20  fee 0.1   <- 1x Cloth, 1x Wisp
 *   5 Cloth  x4        r104  labor  10  fee 0     <- 5x Fiber
 *   3 Wisp   (raw, 10g)   6 Fiber (raw, 0.1g)   9 Sand (raw, 0.5g)
 *
 * Cloth is deliberately shared by two different recipes, one unit each, so that per-branch
 * rounding (1 + 1 = 2 crafts) differs from correct global rounding (ceil(2/4) = 1 craft).
 *
 * Unpriced branch: 10 Essence Charm <- 8 Rare Essence (no price, craftable) <- 7 Mystery Dust
 * (no price, not craftable) + 9 Sand.
 */
function fixture(): DataSet {
  return {
    updated: '2026-01-01',
    items: {
      1: ['Ayanad Robe', 1000],
      2: ['Delphinad Robe', 200],
      3: ['Wisp', 10],
      4: ['Magnificent Robe', 60],
      5: ['Cloth', 2],
      6: ['Fiber', 0.1],
      7: ['Mystery Dust', null],
      8: ['Rare Essence', null],
      9: ['Sand', 0.5],
      10: ['Essence Charm', null],
      11: ['Tie Item', null],
      12: ['Batch Item', null],
      13: ['Filler', 1],
    },
    recipes: [
      { id: 101, name: 'Ayanad Robe', out: [1, 1], labor: 100, fee: 1.5, mats: [[2, 1], [3, 2]] },
      { id: 102, name: 'Delphinad Robe', out: [2, 1], labor: 50, fee: 0.5, mats: [[4, 1], [3, 2], [5, 1]] },
      { id: 103, name: 'Magnificent Robe', out: [4, 1], labor: 20, fee: 0.1, mats: [[5, 1], [3, 1]] },
      { id: 104, name: 'Cloth x4', out: [5, 4], labor: 10, fee: 0, mats: [[6, 5]] },
      { id: 106, name: 'Delphinad Robe (alt)', out: [2, 1], labor: 80, fee: 0.2, mats: [[4, 1], [9, 10]] },
      { id: 107, name: 'Rare Essence', out: [8, 1], labor: 5, fee: 0, mats: [[7, 2]] },
      { id: 108, name: 'Essence Charm', out: [10, 1], labor: 1, fee: 0, mats: [[8, 1], [9, 4]] },
      // Tie-break: same labor per output unit -> lowest recipe id wins.
      { id: 110, name: 'Tie Item (b)', out: [11, 1], labor: 10, fee: 0, mats: [[13, 1]] },
      { id: 109, name: 'Tie Item (a)', out: [11, 1], labor: 10, fee: 0, mats: [[13, 2]] },
      // OUTPUT AMOUNT decides: x2 beats x1 even though 120 is far cheaper per unit (1 vs 6 labor).
      { id: 120, name: 'Batch Item', out: [12, 1], labor: 1, fee: 0, mats: [[13, 1]] },
      { id: 121, name: 'Batch Item x2', out: [12, 2], labor: 12, fee: 0, mats: [[13, 3]] },
    ],
  };
}

/** Wraps a bare items/recipes pair in the `DataSet` envelope. */
const makeIndex = (items: DataSet['items'], recipes: Recipe[]): CraftIndex =>
  buildIndex({ updated: '2026-01-01', items, recipes });

const index = buildIndex(fixture());

/** `calculate` against the fixture; every option defaults to the baseline 1x Ayanad, free labor. */
const run = (opts: Partial<CalcOptions> = {}): CalcResult =>
  calculate(index, { target: 1, qty: 1, goldPerLabor: 0, ...opts });

/** The full craft chain for the baseline run: Cloth -> Magnificent -> Delphinad -> Ayanad. */
const BASELINE_STEPS = [5, 4, 2, 1];

/** The proficiency percentages the UI's preset list offers (`e2e/lib/oracle.ts` pins the markup). */
const UI_STEPS = [0, 5, 10, 15, 20, 25, 30, 35, 40];

const step = (res: CalcResult, itemId: number): Step | undefined =>
  res.steps.find((s) => s.itemId === itemId);
const buy = (res: CalcResult, itemId: number): BuyRow | undefined =>
  res.buyList.find((b) => b.itemId === itemId);

// ---------------------------------------------------------------------------

describe('effectiveLabor', () => {
  it('discounts by the given percent, rounding up, without float drift', () => {
    expect(effectiveLabor(650, 30)).toBe(455); // 650 * 0.7 === 455.00000000000006 in binary float
    expect(effectiveLabor(100, 30)).toBe(70);
    expect(effectiveLabor(50, 30)).toBe(35);
    expect(effectiveLabor(20, 30)).toBe(14);
    expect(effectiveLabor(1, 30)).toBe(1); // ceil(0.7)
    expect(effectiveLabor(650, 0)).toBe(650);
  });

  it('covers the whole 0…40 range the UI offers, in 5 % steps', () => {
    const at = (p: number) => effectiveLabor(100, p);
    expect(UI_STEPS.map(at)).toEqual([100, 95, 90, 85, 80, 75, 70, 65, 60]);
    // Exact, non-step values work identically — that is what the "+" field is for.
    expect(effectiveLabor(100, 27)).toBe(73);
    expect(effectiveLabor(650, 27)).toBe(475); // ceil(474.5)
  });

  it('falls back to the default and clamps nonsense', () => {
    expect(clampProfPercent(undefined)).toBe(DEFAULT_PROF_PERCENT);
    expect(clampProfPercent(Number.NaN)).toBe(DEFAULT_PROF_PERCENT);
    expect(clampProfPercent(-10)).toBe(0);
    expect(clampProfPercent(500)).toBe(100);
    expect(effectiveLabor(100, 100)).toBe(0); // a full discount is free, not negative
  });
});

describe('recursive expansion', () => {
  const res = run();

  it('crafts the whole chain when labor is free', () => {
    expect(res.error).toBeUndefined();
    expect(res.steps.map((s) => s.itemId)).toEqual(BASELINE_STEPS);
  });

  it('lists steps bottom-up with the target last', () => {
    expect(res.steps.at(-1)?.itemId).toBe(1);
    expect(res.steps[0]?.itemId).toBe(5);
  });

  it('aggregates shared materials globally, not per branch', () => {
    // Cloth is needed once by Delphinad and once by Magnificent.
    const cloth = step(res, 5);
    expect(cloth?.needed).toBe(2);
    expect(cloth?.crafts).toBe(1); // ceil(2 / 4), NOT ceil(1/4) + ceil(1/4)
    expect(cloth?.produced).toBe(4);
    expect(cloth?.surplus).toBe(2);

    // Wisp is bought by three different recipes: 2 + 2 + 1.
    const wisp = buy(res, 3);
    expect(wisp?.qty).toBe(5);
    expect(wisp?.total).toBe(50);
  });

  it('buys only true leaves', () => {
    expect(res.buyList.map((b) => b.itemId).sort((a, b) => a - b)).toEqual([3, 6]);
    expect(buy(res, 6)?.qty).toBe(5); // 1 cloth craft x 5 fiber
  });

  it('sorts the buy list by total descending', () => {
    const totals = res.buyList.map((b) => b.total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it('produces the expected totals', () => {
    expect(res.totals.buyGold).toBeCloseTo(50.5, 9); // 5 wisp @10 + 5 fiber @0.1
    expect(res.totals.feeGold).toBeCloseTo(2.1, 9); // 1.5 + 0.5 + 0.1 + 0
    expect(res.totals.labor).toBe(126); // 70 + 35 + 14 + 7
    expect(res.totals.laborGold).toBe(0);
    expect(res.totals.grandTotal).toBeCloseTo(52.6, 9);
  });

  it('keeps labor out of the grand total, however dear labor is', () => {
    // Same materials either way: only the labor PRICE changes, and only the decisions may follow.
    const free = run({ goldPerLabor: 0 });
    const dear = run({ goldPerLabor: 10 });

    expect(free.totals.grandTotal).toBeCloseTo(free.totals.buyGold + free.totals.feeGold, 9);
    expect(dear.totals.grandTotal).toBeCloseTo(dear.totals.buyGold + dear.totals.feeGold, 9);
    // The labor value is still reported, and still moved the craft-vs-buy line (see that suite).
    expect(dear.totals.laborGold).toBeCloseTo(700, 9);
    expect(dear.totals.grandTotal).not.toBeCloseTo(
      dear.totals.buyGold + dear.totals.feeGold + dear.totals.laborGold,
      9,
    );
  });

  it('scales with quantity', () => {
    const ten = run({ qty: 10 });
    expect(step(ten, 1)?.crafts).toBe(10);
    expect(buy(ten, 3)?.qty).toBe(50);
    expect(step(ten, 5)?.needed).toBe(20);
    expect(step(ten, 5)?.crafts).toBe(5); // ceil(20 / 4)
    expect(step(ten, 5)?.surplus).toBe(0);
  });

  it('reports an error when the target has no recipe', () => {
    const bad = run({ target: 3 });
    expect(bad.error).toMatch(/no recipe/i);
    expect(bad.steps).toEqual([]);
  });
});

describe('craft-vs-buy decision', () => {
  it('flips to buying as gold-per-labor rises', () => {
    const dearLabor = run({ goldPerLabor: 10 });
    // Cloth (17.63 > 2), Magnificent (156.10 > 60) and Delphinad (436.50 > 200) all become buys.
    expect(dearLabor.steps.map((s) => s.itemId)).toEqual([1]);
    expect(buy(dearLabor, 2)?.qty).toBe(1);
    expect(buy(dearLabor, 2)?.unitPrice).toBe(200);
    expect(buy(dearLabor, 3)?.qty).toBe(2);
    expect(dearLabor.totals.buyGold).toBeCloseTo(220, 9);
    expect(dearLabor.totals.labor).toBe(70);
    expect(dearLabor.totals.laborGold).toBeCloseTo(700, 9);
    // Labor priced the decision above, but it is not gold paid out — see the totals suite.
    expect(dearLabor.totals.grandTotal).toBeCloseTo(220 + 1.5, 9);
  });

  it('always crafts the target even when buying it would be cheaper', () => {
    const res = run({ goldPerLabor: 1000 });
    expect(step(res, 1)?.crafts).toBe(1);
    expect(buy(res, 1)).toBeUndefined();
  });

  it('buys at the exact break-even price (craft must be strictly cheaper)', () => {
    // Cloth craft cost per unit at goldPerLabor 0 is (5 * 0.1) / 4 = 0.125.
    const equal = run({ priceOverride: { 5: 0.125 } });
    expect(step(equal, 5)).toBeUndefined();
    expect(buy(equal, 5)?.qty).toBe(2);

    const justAbove = run({ priceOverride: { 5: 0.1251 } });
    expect(justAbove.steps.some((s) => s.itemId === 5)).toBe(true);
  });
});

describe('profPercent', () => {
  it('scales the whole labor bill by the discount', () => {
    const at30 = run({ profPercent: 30 });
    const at0 = run({ profPercent: 0 });

    expect(at30.totals.labor).toBe(126); // 70 + 35 + 14 + 7
    expect(at0.totals.labor).toBe(180); // 100 + 50 + 20 + 10
    expect(step(at30, 1)?.laborEach).toBe(70);
    expect(step(at0, 1)?.laborEach).toBe(100);

    // Every step the UI offers is monotonic: more proficiency is never more labor.
    const byStep = UI_STEPS.map((p) => run({ profPercent: p }).totals.labor);
    expect(byStep).toEqual([...byStep].sort((a, b) => b - a));
  });

  it('defaults to 30%', () => {
    expect(run().totals.labor).toBe(126);
    expect(run({ profPercent: DEFAULT_PROF_PERCENT }).totals.labor).toBe(126);
  });

  it('honours an exact, off-step percentage', () => {
    // ceil(100*0.73) + ceil(50*0.73) + ceil(20*0.73) + ceil(10*0.73) = 73 + 37 + 15 + 8
    expect(run({ profPercent: 27 }).totals.labor).toBe(133);
  });

  it('can change a craft-vs-buy decision', () => {
    // At 3 g/labor cloth is bought either way, so Magnificent costs 2 + 10 + 0.1 + labor * 3.
    // Labor 20 -> 14 effective at 30%: 54.1 (craft) vs 72.1 at 0% (price is 60).
    const withProf = run({ goldPerLabor: 3, profPercent: 30 });
    const noProf = run({ goldPerLabor: 3, profPercent: 0 });
    expect(withProf.steps.map((s) => s.itemId)).toEqual([4, 2, 1]);
    expect(noProf.steps.map((s) => s.itemId)).toEqual([1]);
    expect(buy(noProf, 2)?.unitPrice).toBe(200);
  });
});

describe('priceOverride', () => {
  it('replaces the AH price and flags the row', () => {
    const res = run({ priceOverride: { 6: 1 } });
    const fiber = buy(res, 6);
    expect(fiber?.unitPrice).toBe(1);
    expect(fiber?.total).toBe(5);
    expect(fiber?.overridden).toBe(true);
    expect(buy(res, 3)?.overridden).toBe(false);
    expect(res.totals.buyGold).toBeCloseTo(55, 9);
  });

  it('recalculates the decision, not just the price', () => {
    // Cheap cloth on the AH beats crafting it out of fiber.
    const res = run({ priceOverride: { 5: 0.05 } });
    expect(res.steps.some((s) => s.itemId === 5)).toBe(false);
    expect(buy(res, 5)?.qty).toBe(2);
    expect(buy(res, 6)).toBeUndefined(); // fiber subtree gone
  });

  it('propagates up the chain', () => {
    // Expensive wisps make every tier above them uneconomical.
    const res = run({ priceOverride: { 3: 500 } });
    expect(res.steps.map((s) => s.itemId)).toEqual([1]);
    expect(buy(res, 2)?.unitPrice).toBe(200);
    expect(buy(res, 3)?.unitPrice).toBe(500);
  });
});

describe('modeOverride', () => {
  it('force-buying an intermediate collapses its whole subtree', () => {
    const res = run({ modeOverride: { 2: 'buy' } });
    expect(res.steps.map((s) => s.itemId)).toEqual([1]);
    expect(buy(res, 2)?.qty).toBe(1);
    expect(buy(res, 2)?.unitPrice).toBe(200);
    // Everything below Delphinad is gone.
    expect(buy(res, 4)).toBeUndefined();
    expect(buy(res, 5)).toBeUndefined();
    expect(buy(res, 6)).toBeUndefined();
    expect(buy(res, 3)?.qty).toBe(2); // only the target's own wisps remain
    expect(res.totals.feeGold).toBeCloseTo(1.5, 9);
    expect(res.totals.labor).toBe(70);
  });

  it('force-crafting beats a cheaper AH price', () => {
    const res = run({ goldPerLabor: 10, modeOverride: { 2: 'craft' } });
    expect(res.steps.some((s) => s.itemId === 2)).toBe(true);
    expect(buy(res, 2)).toBeUndefined();
  });

  it('is ignored for an item with no recipe', () => {
    const res = run({ modeOverride: { 3: 'craft' } });
    expect(buy(res, 3)?.qty).toBe(5);
  });
});

describe('recipeOverride', () => {
  it('defaults to the biggest batch (most output per craft)', () => {
    // 121 makes 2 per craft and beats 120 (x1) even though 120 is much cheaper per unit.
    const res = run({ target: 12 });
    expect(step(res, 12)?.recipeId).toBe(121);
    expect(step(res, 12)?.surplus).toBe(1);
  });

  it('breaks an output-amount tie on the lowest labor per unit, then the lowest recipe id', () => {
    const res = run({ target: 11 });
    expect(step(res, 11)?.recipeId).toBe(109);
    expect(buy(res, 13)?.qty).toBe(2); // r109 uses 2 filler, r110 uses 1
  });

  it('uses the requested recipe instead', () => {
    const res = run({ target: 2, recipeOverride: { 2: 106 } });
    expect(step(res, 2)?.recipeId).toBe(106);
    expect(step(res, 2)?.feeTotal).toBeCloseTo(0.2, 9);
    expect(step(res, 2)?.laborEach).toBe(56); // ceil(80 * 0.7)
    expect(buy(res, 9)?.qty).toBe(10); // sand, only used by the alt recipe
  });

  it('applies to sub-recipes too', () => {
    const res = run({ recipeOverride: { 2: 106 } });
    expect(step(res, 2)?.recipeId).toBe(106);
    expect(buy(res, 9)?.qty).toBe(10);
  });

  it('falls back to the default when the override does not make the item', () => {
    const res = run({ target: 2, recipeOverride: { 2: 101 } });
    expect(step(res, 2)?.recipeId).toBe(102);
  });

  it('lists the alternatives on multi-recipe tree nodes, active one marked', () => {
    const res = run({ target: 2 });
    // Delphinad has two recipes (102 default, 106 alt); its options drive the UI selector.
    expect(res.tree.recipeOptions?.map((o) => [o.id, o.selected])).toEqual([
      [102, true],
      [106, false],
    ]);
    // Single-recipe (Magnificent) and raw (Sand via alt path) nodes offer no selector.
    const magnificent = res.tree.children?.[0];
    expect(magnificent?.recipeOptions).toBeUndefined();

    const alt = run({ target: 2, recipeOverride: { 2: 106 } });
    expect(alt.tree.recipeOptions?.find((o) => o.selected)?.id).toBe(106);
    // labor is EFFECTIVE (proficiency applied), like every other labor number: ceil(50 * 0.7).
    expect(alt.tree.recipeOptions?.[0]).toMatchObject({ id: 102, name: 'Delphinad Robe', out: 1, labor: 35 });
  });

  it('keeps the alternatives on bought nodes — picking a recipe there can flip them back', () => {
    const res = run({ modeOverride: { 2: 'buy' } });
    const delphinad = res.tree.children?.[0];
    expect(delphinad?.mode).toBe('buy');
    expect(delphinad?.recipeOptions?.map((o) => [o.id, o.selected])).toEqual([
      [102, true],
      [106, false],
    ]);
  });
});

describe('missing prices', () => {
  it('flags unpriced leaves and prices them at 0', () => {
    const res = run({ target: 10 });
    const dust = buy(res, 7);
    expect(dust?.qty).toBe(2);
    expect(dust?.noPrice).toBe(true);
    expect(dust?.unitPrice).toBe(0);
    expect(dust?.total).toBe(0);
    expect(buy(res, 9)?.noPrice).toBe(false);
  });

  it('forces a craft when the item has a recipe but no price, however dear labor is', () => {
    const res = run({ target: 10, goldPerLabor: 100000 });
    expect(res.steps.map((s) => s.itemId)).toEqual([8, 10]);
    expect(buy(res, 8)).toBeUndefined();
    expect(res.totals.labor).toBe(1 + 4); // ceil(1*0.7) + ceil(5*0.7)
  });

  it('lets a price override rescue an unpriced item', () => {
    const res = run({ target: 10, goldPerLabor: 100000, priceOverride: { 8: 5 } });
    expect(res.steps.map((s) => s.itemId)).toEqual([10]);
    expect(buy(res, 8)?.unitPrice).toBe(5);
    expect(buy(res, 8)?.noPrice).toBe(false);
    expect(buy(res, 8)?.overridden).toBe(true);
  });
});

describe('crafting fees', () => {
  it('never leaks Coin into the buy list and sums fees into feeGold', () => {
    const res = run({ qty: 3 });
    expect(res.buyList.some((b) => b.itemId === 500)).toBe(false);
    // 3 Ayanad (1.5 each) + 3 Delphinad (0.5) + 3 Magnificent (0.1) + 2 Cloth crafts (0)
    expect(step(res, 1)?.feeTotal).toBeCloseTo(4.5, 9);
    expect(res.totals.feeGold).toBeCloseTo(6.3, 9);
    expect(res.totals.grandTotal).toBeCloseTo(res.totals.buyGold + res.totals.feeGold, 9);
  });
});

describe('cycle safety', () => {
  const cyclic = makeIndex({ 20: ['Alpha', 5], 21: ['Beta', 100] }, [
    { id: 201, name: 'Alpha', out: [20, 1], labor: 1, fee: 0, mats: [[21, 1]] },
    { id: 202, name: 'Beta', out: [21, 1], labor: 1, fee: 0, mats: [[20, 1]] },
  ]);

  it('terminates and treats the inner occurrence as a buy', () => {
    const res = calculate(cyclic, { target: 20, qty: 1, goldPerLabor: 0 });
    expect(res.steps.map((s) => s.itemId)).toEqual([21, 20]);
    // Beta's Alpha requirement closes the cycle, so it is bought rather than re-crafted.
    expect(buy(res, 20)?.qty).toBe(1);
    expect(buy(res, 20)?.unitPrice).toBe(5);
    expect(res.totals.labor).toBe(2);
    expect(Number.isFinite(res.totals.grandTotal)).toBe(true);
  });

  it('survives a self-referencing recipe', () => {
    const selfRef = makeIndex({ 30: ['Ouroboros', 7], 31: ['Scale', 1] }, [
      { id: 301, name: 'Ouroboros', out: [30, 1], labor: 2, fee: 0, mats: [[30, 1], [31, 3]] },
    ]);
    const res = calculate(selfRef, { target: 30, qty: 2, goldPerLabor: 0 });
    expect(res.steps.map((s) => s.itemId)).toEqual([30]);
    expect(buy(res, 30)?.qty).toBe(2);
    expect(buy(res, 31)?.qty).toBe(6);
    expect(res.totals.buyGold).toBeCloseTo(2 * 7 + 6 * 1, 9);
  });
});

describe('decision tree', () => {
  it('mirrors the decision per branch', () => {
    const res = run();
    expect(res.tree.itemId).toBe(1);
    expect(res.tree.mode).toBe('craft');
    expect(res.tree.recipeId).toBe(101);
    expect(res.tree.children?.map((c) => c.itemId)).toEqual([2, 3]);
    const delphinad = res.tree.children?.[0];
    expect(delphinad?.mode).toBe('craft');
    expect(delphinad?.children?.map((c) => c.itemId)).toEqual([4, 3, 5]);
    const wisp = res.tree.children?.[1];
    expect(wisp?.mode).toBe('buy');
    expect(wisp?.qty).toBe(2);
    expect(wisp?.unitPrice).toBe(10);
  });

  it('flags which nodes have a recipe at all (the UI only offers a toggle on those)', () => {
    const res = run();
    expect(res.tree.craftable).toBe(true); // Ayanad Robe
    expect(res.tree.children?.[0]?.craftable).toBe(true); // Delphinad Robe, crafted
    expect(res.tree.children?.[1]?.craftable).toBe(false); // Wisp, a raw material
    // Still craftable when the user forced it to buy — that is what makes the toggle reversible.
    const forced = run({ modeOverride: { 2: 'buy' } });
    expect(forced.tree.children?.[0]?.craftable).toBe(true);
  });

  it('reports the batch yield per craft, so the UI can explain the material amounts', () => {
    // Cloth is made 4 at a time; 2 are needed, so one craft overshoots by 2.
    const res = run({ target: 5, qty: 2 });
    expect(res.tree.outAmount).toBe(4);
    expect(res.tree.crafts).toBe(1);
    expect(res.tree.qty).toBe(2);

    // A x1 recipe still reports its yield, so the UI never has to guess.
    expect(run().tree.outAmount).toBe(1);
    // Bought nodes are not crafted, so they have none.
    expect(run().tree.children?.[1]?.outAmount).toBeUndefined();
  });

  it('stops at a force-bought node', () => {
    const res = run({ modeOverride: { 2: 'buy' } });
    const delphinad = res.tree.children?.[0];
    expect(delphinad?.mode).toBe('buy');
    expect(delphinad?.modeOverridden).toBe(true);
    expect(delphinad?.children).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Real-data smoke test — only when `npm run data` has been run.

const dataPath = fileURLToPath(new URL('../public/data.json', import.meta.url));

describe.skipIf(!existsSync(dataPath))('real data smoke test', () => {
  // Parsed in beforeAll, not at collection time: 1.7 MB of JSON must not be read when the suite is
  // skipped (or on every watch-mode re-run).
  let real: DataSet;
  let realIndex: CraftIndex;
  beforeAll(() => {
    real = JSON.parse(readFileSync(dataPath, 'utf8')) as DataSet;
    realIndex = buildIndex(real);
  });

  // NOTE: 7429 is the RECIPE id of Typhoon Trade Pack Storage; the ITEM it makes is 35792 (an
  // easy mix-up — see SPEC). Both are asserted here so it cannot come back.
  const TYPHOON_RECIPE = 7429;
  const TYPHOON_ITEM = 35792;

  it('loads a sane dataset', () => {
    expect(real.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(real.recipes.length).toBeGreaterThan(10000);
    expect(Object.keys(real.items).length).toBeGreaterThan(5000);
  });

  it('never emits Coin as a material', () => {
    expect(real.recipes.some((r) => r.mats.some(([id]) => id === 500))).toBe(false);
    expect(real.items['500']).toBeUndefined();
    const typhoon = real.recipes.find((r) => r.id === TYPHOON_RECIPE);
    expect(typhoon?.out).toEqual([TYPHOON_ITEM, 1]);
    expect(typhoon?.labor).toBe(125);
    expect(typhoon?.fee).toBeCloseTo(0.0002, 12); // 2 Coin
  });

  it('computes 22x Typhoon Trade Pack Storage at 0.3 g/labor', () => {
    const res = calculate(realIndex, {
      target: TYPHOON_ITEM,
      qty: 22,
      goldPerLabor: 0.3,
      profPercent: 30,
    });

    expect(res.error).toBeUndefined();
    expect(res.buyList.length).toBeGreaterThan(0);
    expect(res.steps.length).toBeGreaterThan(0);
    expect(res.steps.at(-1)?.itemId).toBe(TYPHOON_ITEM);
    expect(res.steps.at(-1)?.crafts).toBe(22);
    for (const v of Object.values(res.totals)) expect(Number.isFinite(v)).toBe(true);
    expect(res.totals.grandTotal).toBeGreaterThan(0);
    expect(res.totals.grandTotal).toBeCloseTo(res.totals.buyGold + res.totals.feeGold, 6);
    expect(res.totals.laborGold).toBeGreaterThan(0); // reported, but deliberately not in the total

    const g = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    console.log(
      [
        '',
        `  22x Typhoon Trade Pack Storage (item ${TYPHOON_ITEM}) @ 0.3 g/labor, 30% proficiency`,
        `    steps      : ${res.steps.length}   buy rows: ${res.buyList.length}` +
          `   (${res.buyList.filter((b) => b.noPrice).length} unpriced)`,
        `    buy gold   : ${g(res.totals.buyGold)}`,
        `    fees       : ${g(res.totals.feeGold)}`,
        `    labor      : ${g(res.totals.labor)}  ->  ${g(res.totals.laborGold)} g  (not in the total)`,
        `    GRAND TOTAL: ${g(res.totals.grandTotal)} g  (${g(res.totals.grandTotal / 22)} g each)`,
        `    top buys   : ${res.buyList
          .slice(0, 8)
          .map((b) => `${b.qty}x ${b.name} = ${g(b.total)}`)
          .join(', ')}`,
        '',
      ].join('\n'),
    );
  });

  it('reacts to gold-per-labor across the whole dataset', () => {
    const cheap = calculate(realIndex, { target: TYPHOON_ITEM, qty: 22, goldPerLabor: 0 });
    const dear = calculate(realIndex, { target: TYPHOON_ITEM, qty: 22, goldPerLabor: 50 });
    expect(cheap.totals.labor).toBeGreaterThanOrEqual(dear.totals.labor);
    expect(dear.steps.length).toBeLessThanOrEqual(cheap.steps.length);
  });
});
