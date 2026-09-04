/**
 * search-popup.spec.ts — the item search combobox (`src/ui/search.ts`).
 *
 * Oracle: `searchHits()` reimplements the matcher (substring over craftable item names, earliest hit
 * first) from the same data.json the page loads, so the expected rows and their order are computed,
 * never hardcoded. The query below is chosen only because it over-fills the popup — the spec asserts
 * the cap and the ranking against the oracle, not a row count it knows in advance.
 */
import { test, expect } from '@lib/fixtures';
import { batchTarget, SEARCH_MAX_ROWS, searchHits } from '@lib/oracle';

/** Deliberately broad: more matches than the popup may show, so the cap is exercised. */
const QUERY = 'typhoon';
/** What the popup must list for `QUERY`, uncapped and in ranking order. */
const HITS = searchHits(QUERY);

test.describe('item search popup', () => {
  test.beforeEach(async ({ calc }) => {
    await calc.goto();
  });

  test('lists the matching items, capped, with the best match highlighted', async ({ calc }) => {
    expect(HITS.length, `the fixture query "${QUERY}" must over-fill the popup`).toBeGreaterThan(
      SEARCH_MAX_ROWS,
    );

    await calc.searchFor(QUERY);

    await expect(calc.searchOptions).toHaveCount(SEARCH_MAX_ROWS);
    // Ranking: the popup shows the oracle's top rows, in the oracle's order.
    const shown = await calc.searchOptions.evaluateAll((rows) =>
      rows.map((row) => Number((row as HTMLElement).dataset['itemId'])),
    );
    expect(shown).toEqual(HITS.slice(0, SEARCH_MAX_ROWS).map((hit) => hit.id));

    // The first row is pre-selected, so Enter always has something to pick.
    await expect(calc.activeOption).toHaveCount(1);
    expect(await calc.activeOptionId()).toBe(HITS[0]?.id);
  });

  test('arrow keys move the highlight and Enter picks the highlighted item', async ({ calc }) => {
    const third = HITS[2];
    expect(third, 'the query needs at least three matches to arrow through').toBeDefined();

    await calc.searchFor(QUERY);
    await calc.pressInSearch('ArrowDown');
    await calc.pressInSearch('ArrowDown');
    expect(await calc.activeOptionId()).toBe(third?.id);

    await calc.pressInSearch('Enter');

    // Picking closes the popup, fills the input and renders that item's breakdown.
    await expect(calc.searchPopup).toBeHidden();
    await expect(calc.searchInput).toHaveValue(third?.name ?? '');
    await expect(calc.results).toBeVisible();
    await expect(calc.targetLine).toContainText(`#${third?.id}`);
    await expect(calc.status).toBeHidden();
  });

  test('Escape closes the popup and picks nothing', async ({ calc }) => {
    await calc.searchFor(QUERY);
    await calc.pressInSearch('Escape');

    await expect(calc.searchPopup).toBeHidden();
    // The typed text stays, but no target was chosen: still the empty state.
    await expect(calc.searchInput).toHaveValue(QUERY);
    await expect(calc.results).toBeHidden();
    await expect(calc.status).toBeVisible();
  });

  test('clicking an option selects that item', async ({ calc }) => {
    const pick = HITS[1];
    expect(pick, 'the query needs at least two matches').toBeDefined();

    await calc.searchFor(QUERY);
    await calc.searchOption(pick!.id).click();

    await expect(calc.searchPopup).toBeHidden();
    await expect(calc.searchInput).toHaveValue(pick!.name);
    await expect(calc.targetLine).toContainText(`#${pick!.id}`);
    await expect(calc.results).toBeVisible();
  });

  test('a query nothing matches leaves the popup closed', async ({ calc }) => {
    // No popup to wait for — that is the assertion.
    await calc.typeInSearch('zzz-no-such-item');

    await expect(calc.searchPopup).toBeHidden();
    await expect(calc.searchOptions).toHaveCount(0);
  });

  test('tags a batch item with its batch size, but picks it under its bare name', async ({
    calc,
  }) => {
    const target = batchTarget();
    // A PREFIX, not the whole name: typing the full name would make the closing assertion true no
    // matter what `pick()` does to the input, since the text would already be there.
    const prefix = target.name.slice(0, Math.max(3, Math.ceil(target.name.length / 2)));
    expect(prefix, 'the query must be shorter than the name it picks').not.toBe(target.name);

    await calc.searchFor(prefix);
    await expect(calc.popupBatchTag(target.itemId)).toHaveText(
      `${target.outAmount.toLocaleString('en-US')}x`,
    );

    // The tag is decoration, not part of the name: picking fills the BARE name, so the input is
    // still a query that finds the item again.
    await calc.searchOption(target.itemId).click();
    await expect(calc.searchInput).toHaveValue(target.name);
  });
});
