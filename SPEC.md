# AACraft Web — Craft Calculator (single page)

A single self-contained web page (to be embedded into the sermeatbal site) that computes the full
reagent breakdown for crafting any ArcheAge item, recursing through sub-crafts, with a
craft-vs-buy decision driven by a global "gold per labor" value. **No RNG simulation** — one craft
consumes its materials once and yields its product once (multi-roll recipes are treated as
deterministic; the UI carries a note saying so).

## Source data (read-only, lives in ../AACraft/)

- `../AACraft/crafts_all.json` — 11 005 recipes:
  `{id, name, labor, cast_delay_ms, products:[{item_id, amount, rate, name, icon}], materials:[{item_id, amount, name, icon}]}`
  - `products[].rate` is a **percent** (100 = 100%). For this calculator rate is IGNORED for
    expansion (no simulation): a craft yields the primary product `amount` once.
  - Primary product = the product matching `crafts_index.json`'s `primary_product_id`
    (fall back to `products[0]`).
  - Material with `item_id == 500` (`Coin`) is the gold crafting fee: 1 coin = **0.0001 g**.
    It must NOT appear in the buy list; it becomes a per-craft `fee` in gold.
- `../AACraft/crafts_index.json` — slim lookup `{id, name, primary_product_id, product_name, labor, material_count}`.
- `../AACraft/ahprices.csv` — quoted CSV, header:
  `Item ID, Item Name, 24h Average, 24h Volume, 7d Average, 7d Volume, 30d Average, 30d Volume, Raw Item String` (+ trailing `Last Updated At:` cols in the header row).
  Price = first non-empty of 24h → 7d → 30d average; strip thousands-commas and a trailing `g`.
  Blank = no price.

## Build step — `tools/build-data.mjs` (node, no deps)

Reads the three sources, writes `public/data.json`:

```jsonc
{
  "updated": "2026-08-05",          // from ahprices.csv header stamp
  "items":   { "<id>": ["Name", price|null] },   // every item referenced by any kept recipe or product
  "recipes": [ { "id": 9000280, "name": "Typhoon Trade Pack Storage Design",
                 "out": [35961, 1],              // [primary_product_id, amount]
                 "labor": 250, "fee": 0,         // fee in gold from the Coin material (0 here)
                 "mats": [[9000163, 25]]         // [itemId, amount][], Coin excluded
               } ]
}
```

Keep it compact (arrays, no icons). Target < ~3 MB raw. Deterministic output (sorted keys) so
rebuilds diff cleanly. `public/data.json` is generated → gitignored; `npm run data` rebuilds it.

## Calc engine — `src/engine.ts` (pure, no DOM)

State in → derived result out; fully unit-testable.

Inputs:
- `target: itemId`, `qty: number`
- `goldPerLabor: number` — the global "gold labors" field. Meaning: 1 labor point is worth this
  many gold. When deciding craft-vs-buy for a material, if AH price ≤ recursive craft cost
  (materials + fee + labor × goldPerLabor), the AH price wins.
- `profPercent: number` (default 30, clamped 0…100) — the proficiency discount as a percent of
  labor saved: effective labor = `ceil(labor * (100 - profPercent) / 100)`, multiplied before
  dividing so floats cannot round 455 up to 456.
- Overrides (all per item id):
  - `priceOverride[itemId]` — user-edited unit price (replaces AH price everywhere).
  - `modeOverride[itemId]: 'craft' | 'buy'` — force the decision.
  - `recipeOverride[itemId]: recipeId` — when several recipes produce the item; default recipe =
    biggest batch (highest output amount per craft), ties → lowest (labor / output amount),
    then lowest recipe id.

Decision per node (memoized on itemId, cycle-safe — on a recipe cycle treat the inner
occurrence as buy):
- The top-level target is always crafted (if it has no recipe, that's an input error the UI blocks).
- A material with no recipe → buy.
- A material with a recipe → craft iff `craftUnitCost < buyUnitPrice`, where
  `craftUnitCost = (Σ mat unit costs × amounts + fee + effLabor × goldPerLabor) / outAmount`;
  a missing buy price forces craft; a missing price on a leaf shows as 0 with a "no price" flag.
  Overrides trump everything.

Outputs:
- `steps`: aggregated craft list, bottom-up — `{recipeId, itemName, crafts, laborEach, laborTotal, feeTotal, matsPerCraft}` (crafts = ceil(neededUnits / outAmount); surplus is fine, no fractional crafts).
- `buyList`: aggregated leaf/bought items — `{itemId, name, qty, unitPrice, total, noPrice, overridden}` sorted by total desc.
- Each tree node also carries `branchGold` — what that branch costs in **money**, as opposed to the
  labor-inclusive `craftUnitCost` above, which only DECIDES craft vs buy and is never displayed.
  `qty × unitPrice` when bought; when crafted, `crafts × fee` plus the `branchGold` of every
  material under it. Whole crafts, not per-unit: one craft of a x100 recipe for 30 units is billed
  for 100. So the root node's figure **is** `grandTotal` — exactly, unless a crafted item appears
  in two branches, since the tree rounds crafts up per branch while `steps` aggregates that item's
  demand globally and rounds up once.
- `totals`: `{buyGold, feeGold, labor, laborGold, grandTotal}`. `grandTotal = buyGold + feeGold`:
  labor is **not** money you hand over, so it is reported (`labor`, `laborGold`) but never billed.
  `goldPerLabor` still prices every craft-vs-buy decision above — it just does not inflate the bill.

## UI — `index.html` + `src/main.ts` (+ `src/ui/…`), Vite, vanilla TS, no framework

Single page, desktop-first, works standalone from `dist/` so it can be dropped into the site.

- Top bar: **item search** (input; popup dropdown listing matching craftable items — substring,
  case-insensitive, keyboard ↑↓⏎, max ~50 rows, shows name + id, and the batch size for items made
  in batches), **quantity**, **gold per labor** field with a short hint: "If the AH price is below
  the craft cost at this labor value, the AH price is used", a **proficiency** control, and the
  data `updated` stamp. The proficiency control is a single `<select>` of 0 %, 5 % … 40 %
  (30 % preselected) applying to every craft.
  - It is deliberately ONE global value. A per-profession override (a row per profession, each with
    its own reduction, everything else falling back to the global) was specified and dropped on
    2026-09-04: `crafts_all.json` records no profession for a recipe, so nothing can match a recipe
    to such a row. Revisit only if a profession-per-recipe source appears. The engine's
    `profPercent` already accepts any 0…100 value, so it needs no change if it does.
- Preset buttons (from `src/presets.ts`): at minimum `22× Typhoon Trade Pack Storage`
  (itemId **35792**, qty 22). Note 7429 is the *recipe* id for that pack — item 7429 is an
  unrelated item (Blazing Sun Gauntlets); presets take item ids. Clicking a preset fills
  target+qty and recalcs.
- Target heading: `<qty> × <item name> (#<item id>)`. When the target's own recipe is a batch the
  heading states the batch as a per-craft rate after the id — `1 × Alluvion Love (#42045) 10x per
  craft` — because asking for one of an item whose only recipe makes ten prices ten, and the
  heading is the only place naming it. Not glued to the name the way a tree node tags it: the
  heading already opens with a quantity, so `5 × Hereafter Stone 1,000x` would read as five
  thousand units when it is one craft of a thousand. It follows the selected recipe, so switching a
  multi-recipe target changes it.
- Craft tree: collapsible tree of the decision (craft nodes show crafts × labor **and `branchGold`,
  the gold that branch costs** — materials and crafting fees all the way down, labor excluded; buy
  nodes show qty × price, which is already their gold); per craftable
  node a craft/buy toggle wired to `modeOverride`. A craft node whose
  recipe is a batch (`outAmount > 1`) carries the batch size next to its name (`Fine Lumber 10x`)
  and states what that adds up to — `→ produced for needed` — plus a `+K spare` badge for the
  overshoot, since whole crafts must be paid for in full and the materials below are otherwise
  inexplicable (one craft of Kraken's Might buys reagents for 100). Nodes whose item several
  recipes make (bought ones too — a cheaper recipe can flip the decision back to craft) carry a
  recipe `<select>`, engine default first, wired to `recipeOverride`; picking the default back
  clears the override. Its options carry the batch size the same way the node tag does:
  `<recipe name> 10x (70 labor)`, or `<recipe name> (70 labor)` for a x1 recipe — the labor is
  effective labor, after proficiency.
- **Buy list** table: each row has an editable unit-price `<input>` (prefilled from AH price;
  editing sets `priceOverride` and recalcs live), qty, row total; a **filter** text input above it
  that live-filters rows by substring (the "Darugir-style" search); totals footer
  (buy gold, crafting fees, labor, labor→gold, grand total).
- A visible note: "No RNG: multi-outcome crafts are counted as one craft = one result."
- Everything client-side; `data.json` fetched once. No backend.

## Tests

- Unit: `vitest` over the engine (fixtures with a tiny synthetic recipe set + one real-data smoke
  test if `public/data.json` exists).
- E2E: `@playwright/test` in `e2e/` modeled on `~/sda6/erp-test/e2e` (specs/ + pages/ page
  objects + playwright.config.ts with `webServer` = `vite preview`). Chromium only,
  `reports/` gitignored. Specs: search popup, preset click → buy list appears, price edit
  recalcs totals, buy-list filter, gold-per-labor flip changes a craft/buy decision.

## Conventions

- npm scripts: `data`, `dev`, `build`, `preview`, `test` (vitest), `e2e`.
- TypeScript strict. No runtime deps beyond what's listed. Node 22.
