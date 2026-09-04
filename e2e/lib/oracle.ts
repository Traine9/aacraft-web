/**
 * oracle.ts — the suite's source of truth.
 *
 * erp-test computes every expected value at runtime from the DB the app reads; this app has no DB,
 * its whole world is `public/data.json` (the file `npm run data` generates and `vite build` copies
 * into `dist/`). So the oracle here is: load that same file, run the same `src/engine.ts` the page
 * bundles, and compare the UI's rendered numbers to what the engine says they must be.
 *
 * Consequence — and the reason it is worth the import: no spec hardcodes a gold amount, a labor
 * total or a row count. Regenerate `data.json` from a fresh AH dump and the suite still passes.
 * Every runtime SUBJECT (which row to re-price, which node to force, which labor price flips a
 * decision) is picked here too, so a spec never names an item id either.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndex,
  byNameThenId,
  calculate,
  itemName,
  type CalcOptions,
  type CalcResult,
  type CraftIndex,
  type DataSet,
  type Mode,
  type TreeNode,
} from '../../src/engine';
import { PRESETS, type Preset } from '../../src/presets';
import { MAX_ROWS } from '../../src/ui/search';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let cached: CraftIndex | null = null;

/** The very `data.json` the served page fetches, indexed once per worker process. */
export function craftIndex(): CraftIndex {
  if (cached) return cached;
  const data = JSON.parse(readFileSync(resolve(ROOT, 'public/data.json'), 'utf8')) as DataSet;
  cached = buildIndex(data);
  return cached;
}

export function updatedStamp(): string {
  return craftIndex().data.updated;
}

/**
 * The preset the suite drives the calculator with — the first button on the page, whatever it is.
 * (Today: `22× Typhoon Trade Pack Storage`, item 35792.) Taking it from `src/presets.ts` keeps the
 * specs honest if the preset list is ever reordered.
 */
export function mainPreset(): Preset {
  const preset = PRESETS[0];
  if (!preset) throw new Error('src/presets.ts is empty — the preset specs have no subject');
  return preset;
}

/** The engine inputs that main preset stands for — what every preset-driven spec calculates from. */
export function mainPresetInputs(): { target: number; qty: number } {
  const preset = mainPreset();
  return { target: preset.itemId, qty: preset.qty };
}

// ------------------------------------------------------------------------------ engine runs

/** The gold-per-labor default baked into `index.html`; `boot.spec` pins the markup to it. */
export const UI_GOLD_PER_LABOR = 0.3;

/** `CalcOptions` with the one control the markup gives a default made optional. */
export type EngineInputs = Omit<CalcOptions, 'goldPerLabor'> & { goldPerLabor?: number };

/** Run the engine exactly as `main.ts` does, filling in the page's default labor price. */
export function expected(opts: EngineInputs): CalcResult {
  return calculate(craftIndex(), { goldPerLabor: UI_GOLD_PER_LABOR, ...opts });
}

// --------------------------------------------------------------------------- runtime subjects

/** Longest popup `src/ui/search.ts` will ever render — the module's own cap, not a copy of it. */
export const SEARCH_MAX_ROWS = MAX_ROWS;

export interface SearchHit {
  id: number;
  name: string;
}

/**
 * Independent reimplementation of the search ranking (every craftable item whose name contains the
 * query, earliest hit position first, then by name/id) — uncapped, so a spec can check the cap.
 */
export function searchHits(query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const index = craftIndex();
  const hits: Array<SearchHit & { at: number }> = [];
  for (const itemId of index.recipesByProduct.keys()) {
    const name = itemName(index, itemId);
    const at = name.toLowerCase().indexOf(q);
    if (at >= 0) hits.push({ id: itemId, name, at });
  }
  hits.sort((a, b) => a.at - b.at || byNameThenId(a, b));
  return hits.map(({ id, name }) => ({ id, name }));
}

/**
 * A word that matches SOME but not ALL of `names` — the buy-list filter spec's needle, picked from
 * the data so the spec keeps working when `data.json` is regenerated. Alphabetical, so it is stable.
 */
export function discriminatingTerm(names: readonly string[]): string | null {
  const words = new Set<string>();
  for (const name of names) {
    for (const word of name.toLowerCase().split(/[^a-z]+/)) if (word.length >= 4) words.add(word);
  }
  for (const word of [...words].sort()) {
    const hits = names.filter((name) => name.toLowerCase().includes(word)).length;
    if (hits > 0 && hits < names.length) return word;
  }
  return null;
}

/** An item the UI can point at, named so a failure message says which one it picked. */
export interface Subject {
  itemId: number;
  name: string;
}

/**
 * First buy row with a real auction-house price — a `no price` row has nothing to re-price.
 * Throws (like `mainPreset`) rather than returning null: a breakdown without one leaves the price
 * spec no subject at all, and that is a broken fixture, not a failed expectation.
 */
export function firstPricedBuyRow(base: EngineInputs): Subject {
  const row = expected(base).buyList.find((r) => !r.noPrice && r.unitPrice > 0);
  if (!row) throw new Error('no priced buy row in this breakdown — the price spec has no subject');
  return { itemId: row.itemId, name: row.name };
}

/**
 * A crafted, priced sub-craft directly under the target: forcing it to buy must move it (and drop
 * its materials) from the tree into the buy list.
 */
export function firstForcibleSubCraft(base: EngineInputs): Subject {
  const child = (expected(base).tree.children ?? []).find(
    (node) => node.mode === 'craft' && node.unitPrice !== null,
  );
  if (!child) throw new Error('no priced sub-craft under the target — the force spec has no subject');
  return { itemId: child.itemId, name: child.name };
}

/** A craft node whose recipe makes several units at a time — what the yield display is for. */
export interface BatchCraft extends Subject {
  outAmount: number;
  crafts: number;
  /** Units this branch needs; `crafts * outAmount - needed` is the overshoot the badge shows. */
  needed: number;
}

/**
 * The first craft node IN DOM ORDER whose recipe yields more than one unit per craft.
 *
 * Not the shallowest, unlike the other finders here: `crafts` and `needed` are PER BRANCH, and an
 * item repeated in the tree has different ones at each occurrence (Fine Lumber needs 44 at its
 * first occurrence and 88 higher up). `CalculatorPage.treeNode` resolves to the first occurrence,
 * so that is the branch whose numbers the spec can assert. `walkTree` already visits parents
 * before children, i.e. in DOM order.
 */
export function firstBatchCraft(base: EngineInputs): BatchCraft {
  let found: BatchCraft | null = null;
  walkTree(expected(base).tree, (node) => {
    if (found || node.mode !== 'craft' || (node.outAmount ?? 1) <= 1) return;
    found = {
      itemId: node.itemId,
      name: node.name,
      outAmount: node.outAmount ?? 1,
      crafts: node.crafts ?? 0,
      needed: node.qty,
    };
  });
  if (!found) throw new Error('no batch recipe in this breakdown — the yield spec has no subject');
  return found;
}

/** A multi-recipe craft node plus a non-default recipe to switch it to. */
export interface RecipeChoice extends Subject {
  defaultRecipeId: number;
  altRecipeId: number;
  /** All its recipe ids, in the engine's option order (the default first). */
  recipeIds: number[];
}

/**
 * The shallowest craft node made by several recipes that is still IN the tree after switching to
 * its first alternative — the switch may flip it to buy (a valid outcome the selector survives),
 * but if the dearer material flips a PARENT to buy, the node leaves the tree along with the
 * selector the spec asserts on; such candidates are skipped.
 */
export function firstRecipeChoice(base: EngineInputs): RecipeChoice {
  const candidates = new Map<number, RecipeChoice & { depth: number }>();
  walkTree(expected(base).tree, (node, depth) => {
    if (node.mode !== 'craft' || !node.recipeOptions || candidates.has(node.itemId)) return;
    const active = node.recipeOptions.find((o) => o.selected);
    const alt = node.recipeOptions.find((o) => !o.selected);
    if (!active || !alt) return;
    candidates.set(node.itemId, {
      itemId: node.itemId,
      name: node.name,
      defaultRecipeId: active.id,
      altRecipeId: alt.id,
      recipeIds: node.recipeOptions.map((o) => o.id),
      depth,
    });
  });
  const sorted = [...candidates.values()].sort(byDepthThenId);
  for (const { depth: _depth, ...choice } of sorted) {
    const switched = expected({ ...base, recipeOverride: { [choice.itemId]: choice.altRecipeId } });
    if (modesByItem(switched).has(choice.itemId)) return choice;
  }
  throw new Error('no multi-recipe craft node in this breakdown — the recipe spec has no subject');
}

/** The one "pick the shallowest subject" ordering, shared by the subject finders. */
function byDepthThenId(a: Subject & { depth: number }, b: Subject & { depth: number }): number {
  return a.depth - b.depth || a.itemId - b.itemId;
}

/** Depth-first walk of a decision tree, parents before children (i.e. DOM order). */
function walkTree(node: TreeNode, visit: (node: TreeNode, depth: number) => void): void {
  const go = (n: TreeNode, depth: number): void => {
    visit(n, depth);
    for (const child of n.children ?? []) go(child, depth + 1);
  };
  go(node, 0);
}

/** `itemId -> mode`, first (shallowest) occurrence wins — the mode is decided per item, not per branch. */
function modesByItem(result: CalcResult): Map<number, Mode> {
  const modes = new Map<number, Mode>();
  walkTree(result.tree, (node) => {
    if (!modes.has(node.itemId)) modes.set(node.itemId, node.mode);
  });
  return modes;
}

/** Labor prices to try, cheapest first: the flip search takes the first one that flips a node. */
const HIGHER_GPL = [0.5, 1, 2, 5, 10];

/**
 * The shallowest item that is crafted at the page default gold-per-labor and bought at `high`.
 *
 * It is chosen from the HIGH tree, so the node is guaranteed to still be rendered after the flip
 * (an item whose parent also flipped disappears from the tree entirely and cannot be asserted on).
 */
function findFlip(base: EngineInputs, lowModes: Map<number, Mode>, high: number): Subject | null {
  const candidates: Array<Subject & { depth: number }> = [];
  walkTree(expected({ ...base, goldPerLabor: high }).tree, (node, depth) => {
    if (node.mode !== 'buy' || lowModes.get(node.itemId) !== 'craft') return;
    candidates.push({ itemId: node.itemId, name: node.name, depth });
  });
  candidates.sort(byDepthThenId);
  const best = candidates[0];
  return best ? { itemId: best.itemId, name: best.name } : null;
}

/**
 * The cheapest labor price in `HIGHER_GPL` that flips some node of `base` from craft to buy, and
 * the shallowest node it flips. The default-gpl tree is computed once, whatever the ladder costs.
 */
export function findFlipAtSomeGpl(base: EngineInputs): { gpl: number; flip: Subject } | null {
  const lowModes = modesByItem(expected({ ...base, goldPerLabor: UI_GOLD_PER_LABOR }));
  for (const gpl of HIGHER_GPL) {
    const flip = findFlip(base, lowModes, gpl);
    if (flip) return { gpl, flip };
  }
  return null;
}
