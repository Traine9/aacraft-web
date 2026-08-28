# aacraft-web e2e — @playwright/test

Browser regression suite for the craft calculator page, modelled on `~/sda6/erp-test/e2e` (page
objects, one concern per spec file, no bare selectors in specs, every expected value computed at
runtime from an oracle) at this project's much smaller scale.

The app has no backend, no auth and no test data to seed, so there is exactly one project
(`chromium`) and one lane: the built page served by `vite preview`.

## Quick start

```bash
npm run e2e                       # build + preview + run everything, headless
npm run e2e -- --headed           # watch it
npm run e2e -- specs/buy-list     # one feature
npm run e2e -- --ui               # picker / trace viewer
npx playwright show-report e2e/reports/html
npx tsc -p e2e --noEmit           # typecheck the suite
```

Chromium only: `npx playwright install chromium` once (the bundled revision must match the installed
`@playwright/test`).

## Dependencies live in the ROOT package.json

`@playwright/test` is a devDependency of the app itself, not of a nested `e2e/package.json`. One
lockfile, one `npm ci`, and — the reason it matters here — the specs import `src/engine.ts` and
`src/presets.ts` directly, so suite and app must resolve to the same TypeScript anyway. `e2e/` still
has its own `tsconfig.json` (node types, `@lib/*` + `@pages/*` aliases) so the app's strict DOM
config stays untouched.

One consequence, handled in `vite.config.ts`: vitest's default matcher would collect
`e2e/**/*.spec.ts` as unit tests, so `npm test` is pinned to `tests/**/*.test.ts`.

## data.json

`public/data.json` is generated (`npm run data`) and gitignored, and the page is useless without it.
`playwright.config.ts` builds it at config load if it is missing — not in a `globalSetup`, because
Playwright starts the `webServer` (whose `npm run build` copies `public/` into `dist/`) *before*
global setup runs.

## The oracle

`lib/oracle.ts` loads the same `public/data.json` the served page fetches and runs the same
`src/engine.ts` the page bundles. Specs compare the UI's rendered numbers against that — the local
equivalent of erp-test's DB-as-oracle.

**No spec hardcodes a gold amount, a labor total or a row count.** Subjects are picked from the data
too: which buy row to re-price, which word to filter on (`discriminatingTerm`), which item flips
craft→buy when labor gets expensive (`findFlip`), which preset to drive (`mainPreset`, = the first
button on the page). Regenerate `data.json` from a fresh auction-house dump and the suite still
passes. Money is compared with `expectGold` (half a display cent of tolerance, since the UI renders
2 decimals); labor points are integers and are compared exactly.

## Layout

```
e2e/
├── playwright.config.ts    # chromium project + webServer (npm run build && npm run preview)
├── lib/
│   ├── fixtures.ts         # import { test, expect } from '@lib/fixtures' — `calc` + console guard
│   ├── oracle.ts           # data.json + src/engine.ts = expected values and runtime subjects
│   └── numbers.ts          # parse the UI's "1,234.56g" back to a number; gold tolerance
├── pages/
│   └── calculator-page.ts  # the one page object: every data-testid lives here
└── specs/
    ├── load/boot.spec.ts               # boot, data stamp, single data.json fetch
    ├── search/search-popup.spec.ts     # popup rows/cap/ranking, ↑↓, Enter, Escape, click
    ├── presets/presets.spec.ts         # preset → target, buy list and totals == engine
    ├── buy-list/price-edit.spec.ts     # live re-price, caret survival, override flag, reset
    ├── buy-list/filter.spec.ts         # hide/show rows, totals unchanged, empty row
    └── decisions/craft-vs-buy.spec.ts  # gold-per-labor flip, proficiency, per-node force buy
```

Reports (gitignored): `reports/html`, traces + failure screenshots in `reports/test-results`.

## Two DOM facts the specs depend on

- The buy-list filter **hides** rows (`[hidden]`) instead of removing them, and the `buy-empty` row
  is always in the DOM. Visible rows are `[data-testid="buy-row"]:not([hidden])` — the page object
  exposes that as `visibleBuyRows`; counting `buy-row` counts the hidden ones too.
- An item id can appear at several places in the craft tree. The craft/buy decision is per ITEM, so
  every node for that id agrees — `treeNode(id)` takes the first, and node-scoped locators use
  `> .node-row` so a child's buttons and badges never match the parent's.
