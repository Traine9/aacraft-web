/**
 * proficiency.spec.ts — the proficiency control: a preset list plus an exact-percent escape hatch.
 *
 * Proficiency is a discount on the labor every craft burns, so it moves the labor total (and can
 * move a craft-vs-buy decision, which `craft-vs-buy.spec.ts` covers). Two things are asserted here
 * that the engine cannot: that the markup offers the agreed steps, and that the "+" field overrides
 * the list while it is open and gives the list back when it is closed.
 */
import { test, expect } from '@lib/fixtures';
import { expected, mainPreset, mainPresetInputs, UI_PROF_PERCENT, UI_PROF_STEPS } from '@lib/oracle';

const preset = mainPreset();
const base = mainPresetInputs();

/** A percentage the preset list deliberately does not offer — only the "+" field can reach it. */
const OFF_STEP = 27;

test.describe('proficiency', () => {
  // Only the two repricing tests need a breakdown; the markup pin below asserts nothing about it.
  test('offers 0…40 in steps of 5, with the default preselected', async ({ calc }) => {
    await calc.goto();
    expect(await calc.profOptionValues()).toEqual(UI_PROF_STEPS);
    await expect(calc.profSelect).toHaveValue(String(UI_PROF_PERCENT));
    await expect(calc.profExact, 'the exact field starts closed').toBeHidden();
  });

  test('every step reprices the labor bill exactly as the engine says', async ({ calc }) => {
    await calc.openWithPreset(preset.itemId);
    // Two steps either side of the default, so the assertion covers more and less proficiency.
    for (const percent of [0, 15, 40]) {
      await calc.setProficiency(percent);
      const want = expected({ ...base, profPercent: percent });
      expect(await calc.totals(), `labor bill at ${percent}%`).toMatchObject({
        labor: want.totals.labor,
      });
    }
  });

  test('the "+" field sets an exact percentage and hands control back when closed', async ({
    calc,
  }) => {
    await calc.openWithPreset(preset.itemId);
    const atDefault = await calc.totals();

    await calc.setExactProficiency(OFF_STEP);
    await expect(calc.profSelect, 'the list is inert while the exact field is open').toBeDisabled();
    expect(UI_PROF_STEPS).not.toContain(OFF_STEP);
    expect(await calc.totals()).toMatchObject({
      labor: expected({ ...base, profPercent: OFF_STEP }).totals.labor,
    });

    // Closing it drops back to whatever the list still holds — the override is reversible.
    await calc.toggleExactProficiency();
    await expect(calc.profExact).toBeHidden();
    await expect(calc.profSelect).toBeEnabled();
    expect(await calc.totals()).toEqual(atDefault);
  });
});
