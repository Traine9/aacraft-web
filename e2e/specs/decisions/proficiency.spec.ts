/**
 * proficiency.spec.ts — the global proficiency control.
 *
 * Proficiency is a discount on the labor every craft burns, so it moves the labor total (and can
 * move a craft-vs-buy decision, which `craft-vs-buy.spec.ts` covers). One thing is asserted here
 * that the engine cannot: that the markup offers the agreed steps, with the default preselected.
 *
 * It is deliberately ONE global value. A per-profession override was considered and dropped: the
 * recipe dump carries no profession for a recipe, so nothing could match a recipe to such a row.
 */
import { test, expect } from '@lib/fixtures';
import { expected, mainPreset, mainPresetInputs, UI_PROF_PERCENT, UI_PROF_STEPS } from '@lib/oracle';

const preset = mainPreset();
const base = mainPresetInputs();

test.describe('proficiency', () => {
  test('offers 0…40 in steps of 5, with the default preselected', async ({ calc }) => {
    // Markup only — no breakdown needed, so this one skips the preset render.
    await calc.goto();
    expect(await calc.profOptionValues()).toEqual(UI_PROF_STEPS);
    await expect(calc.profSelect).toHaveValue(String(UI_PROF_PERCENT));
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

  test('picking the default back restores the original bill', async ({ calc }) => {
    await calc.openWithPreset(preset.itemId);
    const atDefault = await calc.totals();

    await calc.setProficiency(0);
    expect(await calc.totals()).not.toEqual(atDefault);

    await calc.setProficiency(UI_PROF_PERCENT);
    expect(await calc.totals()).toEqual(atDefault);
  });
});
