#!/usr/bin/env node
/**
 * Builds `public/data.json` from the read-only game dumps in ../AACraft/.
 *
 * See SPEC.md "Build step". No dependencies, node 22.
 *
 * Output (compact, deterministic — sorted by id so rebuilds diff cleanly):
 *   { updated, items: { "<id>": [name, price|null] }, recipes: [{id,name,out,labor,fee,mats}] }
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = resolve(ROOT, '..', 'AACraft');
const OUT_DIR = resolve(ROOT, 'public');
const OUT_FILE = resolve(OUT_DIR, 'data.json');

/** Item id of `Coin`: it is the gold crafting fee, not a buyable material. */
const COIN_ITEM_ID = 500;
/** 1 coin = 0.0001 g (10 000 coins to the gold). */
const COINS_PER_GOLD = 10000;

// ---------------------------------------------------------------- CSV parsing

/**
 * Minimal but correct RFC-4180 CSV reader: handles quoted fields, doubled
 * quotes inside them, embedded commas/newlines, and CRLF.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let dirty = false; // did we see anything on this row at all?

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      dirty = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      dirty = true;
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      dirty = false;
    } else if (c === '\r') {
      // ignore; the \n terminates the record
    } else {
      field += c;
      dirty = true;
    }
  }
  if (dirty || field !== '') {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Price cell -> gold number. Strips thousands-commas and a trailing `g`.
 * Blank / unparseable / non-positive => null (no price).
 *
 * Note: a 0 in the sheet means "no data", so it becomes null here — unlike the engine, where an
 * explicit user price override of 0 is honoured as "free".
 * @param {string | undefined} raw
 * @returns {number | null}
 */
function parsePrice(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/,/g, '');
  s = s.replace(/[gG]$/, '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// ------------------------------------------------------------------- sources

const readJson = (name) => JSON.parse(readFileSync(resolve(SRC, name), 'utf8'));

/** @type {Array<{id:number,name:string,labor:number,products:Array<any>,materials:Array<any>,primary_product_id?:number}>} */
const craftsAll = readJson('crafts_all.json');
/** @type {Array<{id:number,primary_product_id:number,product_name:string}>} */
const craftsIndex = readJson('crafts_index.json');

// crafts_index is consulted for one thing only: which product of a recipe is the primary one.
// Its `product_name` is not needed — crafts_all names every product and material we keep.
const primaryById = new Map();
for (const r of craftsIndex) {
  if (r && typeof r.id === 'number' && typeof r.primary_product_id === 'number') {
    primaryById.set(r.id, r.primary_product_id);
  }
}

const csvRows = parseCsv(readFileSync(resolve(SRC, 'ahprices.csv'), 'utf8'));
const header = csvRows[0] ?? [];

// `updated` stamp: the header row carries `... ,Last Updated At:,<date>`
let updated = '';
{
  const at = header.findIndex((c) => c.trim().toLowerCase() === 'last updated at:');
  if (at >= 0) updated = (header[at + 1] ?? '').trim();
}

// Column indices, resolved from the header so a reshuffle upstream cannot silently break us.
const col = (label) => header.findIndex((c) => c.trim().toLowerCase() === label);
const C_ID = col('item id');
const C_NAME = col('item name');
const PRICE_COLS = [col('24h average'), col('7d average'), col('30d average')];
if (C_ID < 0 || C_NAME < 0 || PRICE_COLS.some((i) => i < 0)) {
  throw new Error(`ahprices.csv: unexpected header: ${JSON.stringify(header)}`);
}

/** @type {Map<number, {name: string, price: number|null}>} */
const ah = new Map();
for (let i = 1; i < csvRows.length; i++) {
  const row = csvRows[i];
  if (!row) continue;
  const idRaw = (row[C_ID] ?? '').trim();
  if (!/^\d+$/.test(idRaw)) continue;
  const id = Number(idRaw);
  let price = null;
  for (const ci of PRICE_COLS) {
    price = parsePrice(row[ci]);
    if (price !== null) break; // 24h -> 7d -> 30d
  }
  const name = (row[C_NAME] ?? '').trim();
  // Later duplicate rows do not clobber an earlier priced one.
  const prev = ah.get(id);
  if (prev && prev.price !== null && price === null) continue;
  ah.set(id, { name, price });
}

// ------------------------------------------------------------------- recipes

/** @type {Array<{id:number,name:string,out:[number,number],labor:number,fee:number,mats:Array<[number,number]>}>} */
const recipes = [];
/** item id -> best known display name (first non-empty wins, recipe data preferred) */
const recipeNames = new Map();
const referenced = new Set();

const noteName = (itemId, name) => {
  const nm = typeof name === 'string' ? name.trim() : '';
  if (nm && !recipeNames.has(itemId)) recipeNames.set(itemId, nm);
};

let skippedNoProduct = 0;

for (const r of craftsAll) {
  if (!r || typeof r.id !== 'number') continue;
  const products = Array.isArray(r.products) ? r.products : [];
  const materials = Array.isArray(r.materials) ? r.materials : [];

  // Learn names from every product/material, even of recipes we end up skipping.
  for (const p of products) if (typeof p?.item_id === 'number') noteName(p.item_id, p.name);
  for (const m of materials) if (typeof m?.item_id === 'number') noteName(m.item_id, m.name);

  // Primary product per SPEC: the one crafts_index points at, else the first product.
  const primaryId = primaryById.get(r.id);
  const product = products.find((p) => p?.item_id === primaryId) ?? products[0];
  if (!product) {
    skippedNoProduct++;
    continue;
  }
  const outId = product.item_id;
  const outAmount = Number(product.amount) > 0 ? Number(product.amount) : 1;
  // NOTE: product.rate (a percent) is deliberately ignored — no RNG simulation, see SPEC.

  let coins = 0;
  /** @type {Map<number, number>} */
  const mats = new Map(); // merge duplicate material rows, keep first-seen order
  for (const m of materials) {
    const mid = m?.item_id;
    const amt = Number(m?.amount);
    if (typeof mid !== 'number' || !Number.isFinite(amt) || amt <= 0) continue;
    if (mid === COIN_ITEM_ID) {
      coins += amt;
      continue;
    }
    mats.set(mid, (mats.get(mid) ?? 0) + amt);
  }

  const labor = Number.isFinite(Number(r.labor)) ? Number(r.labor) : 0;
  const fee = coins / COINS_PER_GOLD;

  referenced.add(outId);
  for (const mid of mats.keys()) referenced.add(mid);

  recipes.push({
    id: r.id,
    name: typeof r.name === 'string' ? r.name : '',
    out: [outId, outAmount],
    labor,
    fee,
    mats: [...mats.entries()],
  });
}

recipes.sort((a, b) => a.id - b.id);

// --------------------------------------------------------------------- items

// Last-ditch naming: a fair number of products carry an empty `name` in the dump, but the recipe
// that makes them is named. Recipe names carry a batch suffix ("Jujube Sparkling Wine x50") — strip
// it. Lowest recipe id wins so the choice is deterministic.
const recipeTitleByItem = new Map();
for (const r of recipes) {
  const [outId, outAmount] = r.out;
  if (recipeTitleByItem.has(outId)) continue; // recipes are sorted by id
  const nm = r.name.replace(/\s*x\s*\d+\s*$/i, '').trim();
  if (nm) recipeTitleByItem.set(outId, outAmount > 1 ? nm : r.name.trim());
}

const items = {};
for (const id of [...referenced].sort((a, b) => a - b)) {
  const fromAh = ah.get(id);
  const name =
    recipeNames.get(id) ||
    (fromAh?.name ?? '') ||
    recipeTitleByItem.get(id) ||
    `Item ${id}`;
  items[String(id)] = [name, fromAh?.price ?? null];
}

// -------------------------------------------------------------------- output

const data = { updated, items, recipes };
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(data));

const bytes = statSync(OUT_FILE).size;
const priced = Object.values(items).filter((v) => v[1] !== null).length;
console.log(`data.json  ${(bytes / 1024 / 1024).toFixed(2)} MB  (${bytes.toLocaleString('en-US')} bytes)`);
console.log(`  updated : ${updated || '(missing!)'}`);
console.log(`  recipes : ${recipes.length}${skippedNoProduct ? ` (skipped ${skippedNoProduct} with no product)` : ''}`);
console.log(`  items   : ${Object.keys(items).length} (${priced} priced, ${Object.keys(items).length - priced} without a price)`);
