# AACraft Web

Single-page ArcheAge craft calculator, built to be embedded into the sermeatbal site. Pick an item
(search popup over 8,260 craftable items), set quantity and a global gold-per-labor value, and get
the full recursive reagent breakdown: a collapsible craft tree with per-node craft/buy toggles and
an aggregated buy list with editable unit prices and a live filter. Deterministic — no RNG/roll
simulation. See `SPEC.md` for the full contract.

## Commands

```bash
npm install
npm run data      # generate public/data.json from ../AACraft dumps (required once)
npm run dev       # dev server
npm run build     # production build into dist/ (relative base — embeddable at any subpath)
npm test          # 52 engine unit tests (vitest)
npm run e2e       # 32 Playwright tests (builds data + app, serves via vite preview)
```

`npm run data` reads the game dumps from `../AACraft/`. That folder only exists on the machine they
were dumped on, so gzipped copies live in [`data/`](data/README.md) for CI —
`AACRAFT_DATA_DIR=data npm run data` builds from those instead.

## Live page

<https://traine9.github.io/aacraft-web/> — published by `.github/workflows/deploy.yml` on every push
to `main`, and **twice a day at 12:00 and 19:00 Kyiv time**, which is what keeps the auction-house
prices current: the workflow downloads a fresh snapshot from the community sheet at build time
rather than committing one. If the sheet is unreachable or returns something that is not the sheet,
it falls back to `data/ahprices.csv.gz` with a warning instead of publishing a price-less page.

Every deploy runs typecheck, the unit tests and the full e2e suite against the prices it just
downloaded; a snapshot that breaks the page leaves the last good one live.

Two scheduling details worth knowing:

- **Cron is UTC**, so the workflow fires at 09/10/16/17 UTC and a guard job drops the two runs that
  are not 12:00 or 19:00 in Kyiv. That is what makes the local times survive daylight saving; edit
  the `TZ=Europe/Kyiv` check and the `cron:` line together.
- **GitHub is loose about scheduled runs** — a few minutes late is normal, and it disables the
  schedule entirely after 60 days with no commits to the repo. A push, or "Run workflow" on the
  Actions tab, re-arms it.

## Embedding

`npm run build` emits `dist/` with `base: './'` — copy the folder to any path on the site
(e.g. `/tools/aacraft/`) and serve it statically. `data.json` (1.7 MB raw, ~290 KB gzipped —
make sure the host gzips `.json`) ships alongside and is the page's only network dependency.

## Refreshing prices by hand

For a local rebuild: update `../AACraft/ahprices.csv` (`data/README.md` has the export URL), re-run
`npm run data`, redeploy `dist/` + `public/data.json`. E2E assertions are data-independent:
expected values are computed at test time by running `src/engine.ts` on the same `data.json`
the page serves.
