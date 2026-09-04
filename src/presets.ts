/**
 * One-click starting points for the calculator. `itemId` is always an ITEM id (not a recipe id —
 * e.g. 7429 is the recipe for the Typhoon pack, while item 7429 is Blazing Sun Gauntlets).
 * Every id below was verified against `public/data.json` (craftable, non-empty breakdown).
 */
export interface Preset {
  label: string;
  itemId: number;
  qty: number;
}

export const PRESETS: readonly Preset[] = [
  { label: '22× Typhoon Trade Pack Storage', itemId: 35792, qty: 22 },
  { label: '1× Ayanad Windsong Cloak', itemId: 39175, qty: 1 },
  { label: '1× Erenor Flame Lunafrost', itemId: 43154, qty: 1 },
  { label: '100× Starshard Ingot', itemId: 3332, qty: 100 },
];

/**
 * Proficiency discounts the control offers, in percent of labor saved. THE source of the list:
 * `main.ts` renders the `<select>` from it (the markup ships an empty one) and both test suites
 * import it, so the offered options cannot drift from the tested ones. The engine accepts any
 * 0…100 value — this is only what the UI puts within one click.
 */
export const PROF_STEPS: readonly number[] = [0, 5, 10, 15, 20, 25, 30, 35, 40];
