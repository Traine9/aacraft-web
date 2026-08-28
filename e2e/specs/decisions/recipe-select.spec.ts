/**
 * recipe-select.spec.ts — the recipe selector on multi-recipe craft nodes.
 *
 * Some items are made by several recipes (the ×10/×100 "Batch Processing" variants of the ×1
 * recipe, mostly). The engine defaults to the biggest batch; a craft node whose item has
 * alternatives carries a `<select>` that switches the whole breakdown to the chosen recipe.
 *
 * The subject node and its alternative recipe are picked from the engine at runtime by
 * `lib/oracle.ts`, so nothing here names an item, a recipe or a gold amount.
 */
import { test, expect } from '@lib/fixtures';
import { expectGold } from '@lib/numbers';
import { expected, firstRecipeChoice, mainPreset, mainPresetInputs } from '@lib/oracle';

const preset = mainPreset();
const base = mainPresetInputs();
const subject = firstRecipeChoice(base);

test.describe('recipe selector', () => {
  test.beforeEach(async ({ calc }) => {
    await calc.openWithPreset(preset.itemId);
    await calc.expandAll();
  });

  test('a multi-recipe craft node offers its recipes, biggest batch preselected', async ({ calc }) => {
    const select = calc.recipeSelect(subject.itemId);
    await expect(select, `${subject.name} is made by several recipes`).toBeVisible();
    await expect(select).toHaveValue(String(subject.defaultRecipeId));

    // Exactly the engine's options, in the engine's order.
    expect(await calc.recipeOptionIds(subject.itemId)).toEqual(subject.recipeIds);
  });

  test('switching the recipe recalculates the whole breakdown', async ({ calc }) => {
    await calc.chooseRecipe(subject.itemId, subject.altRecipeId);
    await calc.expandAll();

    const want = expected({ ...base, recipeOverride: { [subject.itemId]: subject.altRecipeId } });
    await expect(calc.recipeSelect(subject.itemId)).toHaveValue(String(subject.altRecipeId));

    const totals = await calc.totals();
    expect(totals.labor).toBe(want.totals.labor);
    expectGold(totals.buyGold, want.totals.buyGold, 'buy gold with the alternative recipe');
    expectGold(totals.grandTotal, want.totals.grandTotal, 'grand total with the alternative recipe');
    expect(await calc.visibleBuyRowIds()).toEqual(want.buyList.map((row) => row.itemId));

    // ...and back to the default: the selector is not one-way.
    await calc.chooseRecipe(subject.itemId, subject.defaultRecipeId);
    const restored = expected(base);
    expectGold((await calc.totals()).grandTotal, restored.totals.grandTotal, 'grand total restored');
  });
});
