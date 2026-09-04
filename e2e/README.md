# aacraft-web e2e — @playwright/test

Browser regression suite for the craft calculator page, modelled on `~/sda6/erp-test/e2e` (page
objects, one concern per spec file, no bare selectors in specs, every expected value computed at
runtime from an oracle) at this project's much smaller scale.

## Quick start

```bash
npm run e2e                       # generate data + build + preview + run everything, headless
npm run e2e -- --headed           # watch it
npm run e2e -- specs/buy-list     # one feature
npm run e2e -- --ui               # picker / trace viewer
npx playwright show-report e2e/reports/html
npx tsc -p e2e --noEmit           # typecheck the suite
```

Chromium only: `npx playwright install chromium` once. `@playwright/test` is a devDependency of the
app itself (one lockfile, one `npm ci`) — the suite imports `src/` directly, so it must resolve to
the same TypeScript the page bundles.

## Layout

```
e2e/
├── playwright.config.ts    # chromium project + webServer (data, build, preview) — owns the rationale
├── lib/
│   ├── fixtures.ts         # import { test, expect } from '@lib/fixtures' — `calc` + console guard
│   ├── oracle.ts           # data.json + src/engine.ts = expected values and runtime subjects
│   └── numbers.ts          # parse the UI's "1,234.56g" back to a number; gold tolerance
├── pages/
│   └── calculator-page.ts  # the one page object: every data-testid and data-* convention lives here
└── specs/
    ├── load/boot.spec.ts               # boot, data stamp, single data.json fetch
    ├── search/search-popup.spec.ts     # popup rows/cap/ranking, ↑↓, Enter, Escape, click
    ├── presets/presets.spec.ts         # preset → target, buy list and totals == engine
    ├── buy-list/price-edit.spec.ts     # live re-price, caret survival, override flag, reset
    ├── buy-list/filter.spec.ts         # hide/show rows, totals unchanged, empty row
    ├── decisions/craft-vs-buy.spec.ts  # gold-per-labor flip, per-node force buy
    ├── decisions/proficiency.spec.ts   # every step reprices labor, default restores the bill
    ├── decisions/recipe-select.spec.ts # options offered, biggest batch default, switch recalcs
    ├── decisions/batch-yield.spec.ts   # batch tag, yield line, surplus badge, target heading
    └── decisions/node-gold.spec.ts     # branch gold per craft node, == grand total, labor-free
```

Reports (gitignored): `reports/html`, traces + failure screenshots in `reports/test-results`.

## Writing a spec

- **Import `test`/`expect` from `@lib/fixtures`**, never from `@playwright/test`: that is where the
  `calc` page object and the console-error guard come from.
- **No selector, `data-testid` or `data-*` convention in a spec.** Add a named member to
  `pages/calculator-page.ts` instead — its header explains the DOM conventions those members encode
  (hidden vs removed rows, repeated item ids, absent-means-false flags).
- **No hardcoded gold amount, labor total, row count or item id.** Expected values come from
  `expected()` in `lib/oracle.ts`; so do the subjects (`mainPreset`, `firstPricedBuyRow`,
  `firstForcibleSubCraft`, `findFlipAtSomeGpl`, `discriminatingTerm`) — see that file's header.
  Regenerate `data.json` from a fresh auction-house dump and the suite still passes.
- **Compare money with `expectGold`** (`lib/numbers.ts`, half a display cent of tolerance); labor
  points and quantities are integers and are compared exactly.
- **Prefer one batched read** (`visibleBuyRowCells()`) over a per-row loop of locator reads, and keep
  an auto-waiting assertion as the gate before it.
