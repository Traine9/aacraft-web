# `data/` — the build inputs, so CI can build without this workstation

`npm run data` normally reads the game dumps from `../AACraft/`, which only exists on the machine
they were dumped on. GitHub Actions has no such sibling folder, so the same three files live here,
gzipped (13 MB of JSON → 780 KB). `AACRAFT_DATA_DIR=data` points the build at them; see the header
of `tools/build-data.mjs`.

| File | What it is | Refreshed |
|---|---|---|
| `crafts_all.json.gz` | Every recipe: labor, products, materials | By hand, when the game patches |
| `crafts_index.json.gz` | Slim lookup; used only for `primary_product_id` | Same |
| `ahprices.csv.gz` | Auction-house price snapshot | **Every deploy**, see below |

## Prices are not read from here in CI

`.github/workflows/deploy.yml` downloads a fresh `ahprices.csv` from the public community sheet
before building, and `readSource()` prefers a plain file over the `.gz` beside it — so the download
wins and this snapshot is only the fallback that keeps the site building if the sheet is
unreachable. It will go stale; that is fine, and the page shows the snapshot date it built from.

Refreshing the snapshot by hand (also how `../AACraft/ahprices.csv` is refreshed):

```sh
curl -sL "https://docs.google.com/spreadsheets/d/1VezKZkoRFzTnB0hLpTroTRFG40NH5vEpfMjWtWCCXIc/export?format=csv" \
  | gzip -9 > data/ahprices.csv.gz
```

## Re-gzipping the recipe dumps after a game patch

```sh
gzip -9 -c ../AACraft/crafts_all.json   > data/crafts_all.json.gz
gzip -9 -c ../AACraft/crafts_index.json > data/crafts_index.json.gz
```
