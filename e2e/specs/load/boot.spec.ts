/**
 * boot.spec.ts — the page's one network dependency and its opening state.
 *
 * `main.ts::boot()` fetches `data.json`, stamps the header with `data.updated`, wires the controls
 * and calls `recalc()`, which — with no target picked — shows the "pick an item" status instead of
 * the results panel. Nothing else happens until the user acts.
 */
import { test, expect } from '@lib/fixtures';
import { updatedStamp, UI_GOLD_PER_LABOR } from '@lib/oracle';

test.describe('page load', () => {
  test('boots into the empty state with the data stamp and the no-RNG note', async ({ calc }) => {
    await calc.goto();

    // The stamp is the `updated` field of the very data.json the suite uses as its oracle.
    await expect(calc.updatedStamp).toHaveText(updatedStamp());
    await expect(calc.updatedStamp).toHaveText(/^\d{4}-\d{2}-\d{2}$/);

    // The whole oracle runs at this labor price: if the markup's default ever moves, every
    // "expected" number in the suite would be computed for inputs the page does not have.
    await expect(calc.goldPerLaborInput).toHaveValue(String(UI_GOLD_PER_LABOR));

    // SPEC: the page must always carry the "one craft = one result" note.
    await expect(calc.rngNote).toBeVisible();
    await expect(calc.rngNote).toContainText('No RNG');

    // No target yet: status instead of results.
    await expect(calc.status).toBeVisible();
    await expect(calc.status).toContainText('Pick an item');
    await expect(calc.results).toBeHidden();

    // The presets are rendered by the same boot, and are the only way in that needs no typing.
    await expect(calc.presetButtons.first()).toBeVisible();
  });

  test('fetches data.json exactly once, and serves it from the built bundle', async ({ calc, page }) => {
    // index.html preloads data.json and boot() fetches it; the preload must be reused, not doubled.
    // One entry, and it is a 200 — a second response would mean the preload was wasted.
    const statuses: number[] = [];
    page.on('response', (res) => {
      if (res.url().endsWith('data.json')) statuses.push(res.status());
    });

    await calc.goto();

    expect(statuses, 'one 200 response for data.json').toEqual([200]);
  });
});
