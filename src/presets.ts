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
