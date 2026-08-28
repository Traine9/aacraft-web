/**
 * filter.spec.ts — the buy-list filter box.
 *
 * It is a VIEW-only control: `applyFilter()` toggles `hidden` on the rows and never re-runs the
 * engine, so the totals must not move — that is the property this spec is really about. Rows are
 * hidden, not removed, so everything counts `buy-row:not([hidden])`.
 *
 * The needle is picked at runtime (`discriminatingTerm`) as a word matching some but not all of the
 * preset's rows, so the spec survives a regenerated data.json.
 */
import { test, expect } from '@lib/fixtures';
import { discriminatingTerm, expected, mainPreset, mainPresetInputs } from '@lib/oracle';

const preset = mainPreset();
const base = mainPresetInputs();
const NO_MATCH = 'zzz-no-such-item';

test.describe('buy list — filter', () => {
  test.beforeEach(async ({ calc }) => {
    await calc.openWithPreset(preset.itemId);
  });

  test('filters rows down to the matches and leaves the totals alone', async ({ calc }) => {
    const rows = expected(base).buyList;
    const term = discriminatingTerm(rows.map((row) => row.name));
    expect(term, 'the preset buy list must contain a partially matching word').not.toBeNull();

    const totalsBefore = await calc.totals();
    const allIds = await calc.visibleBuyRowIds();

    await calc.setFilter(term!);

    const visible = await calc.visibleBuyRowNames();
    expect(visible.length, `"${term}" matches at least one row`).toBeGreaterThan(0);
    expect(visible.length, `"${term}" does not match every row`).toBeLessThan(allIds.length);
    for (const row of visible) {
      expect(row.name.toLowerCase(), `visible row "${row.name}" matches the filter`).toContain(term);
    }
    // The rows that disappeared are exactly the non-matching ones — nothing was removed from the DOM.
    await expect(calc.buyRows).toHaveCount(allIds.length);
    await expect(calc.buyEmpty).toBeHidden();

    expect(await calc.totals(), 'filtering is view-only').toEqual(totalsBefore);
  });

  test('a filter nothing matches shows the empty row and still keeps the totals', async ({ calc }) => {
    const totalsBefore = await calc.totals();
    const allIds = await calc.visibleBuyRowIds();

    await calc.setFilter(NO_MATCH);

    await expect(calc.visibleBuyRows).toHaveCount(0);
    await expect(calc.buyEmpty).toBeVisible();
    await expect(calc.buyEmpty).toContainText('No item matches the filter');
    expect(await calc.totals()).toEqual(totalsBefore);

    // Clearing brings every row back.
    await calc.setFilter('');
    expect(await calc.visibleBuyRowIds()).toEqual(allIds);
    await expect(calc.buyEmpty).toBeHidden();
  });

  test('the filter also matches on item id', async ({ calc }) => {
    const [first] = await calc.visibleBuyRowIds();
    expect(first, 'the preset renders at least one buy row').toBeDefined();

    await calc.setFilter(String(first));

    const visible = await calc.visibleBuyRowIds();
    expect(visible, 'the searched id is among the matches').toContain(first);
  });
});
