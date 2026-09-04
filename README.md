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
npm test          # 46 engine unit tests (vitest)
npm run e2e       # 25 Playwright tests (builds data + app, serves via vite preview)
```

## Embedding

`npm run build` emits `dist/` with `base: './'` — copy the folder to any path on the site
(e.g. `/tools/aacraft/`) and serve it statically. `data.json` (1.7 MB raw, ~290 KB gzipped —
make sure the host gzips `.json`) ships alongside and is the page's only network dependency.

## Refreshing prices

Update `../AACraft/ahprices.csv` (see the AACraft workspace notes for the Google-Sheet export),
re-run `npm run data`, redeploy `dist/` + `public/data.json`. E2E assertions are data-independent:
expected values are computed at test time by running `src/engine.ts` on the same `data.json`
the page serves.
