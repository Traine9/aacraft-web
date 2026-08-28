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

// --------------------------------------------------------------------------- runtime subjects

/** Longest popup `src/ui/search.ts` will ever render. */
export const SEARCH_MAX_ROWS = 50;

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

/** The engine inputs the UI starts from: the defaults baked into `index.html`. */
export const UI_DEFAULTS = { goldPerLabor: 0.3, profReduction: true } as const;

/** `CalcOptions` with the two controls that have a default in the markup made optional. */
export type EngineInputs = Omit<CalcOptions, 'goldPerLabor'>;

/** Run the engine exactly as `main.ts` does, filling in the page's default controls. */
export function expected(opts: EngineInputs & { goldPerLabor?: number }): CalcResult {
  return calculate(craftIndex(), {
    goldPerLabor: UI_DEFAULTS.goldPerLabor,
    profReduction: UI_DEFAULTS.profReduction,
    ...opts,
  });
}

/** Depth-first walk of a decision tree, parents before children (i.e. DOM order). */
export function walkTree(node: TreeNode, visit: (node: TreeNode, depth: number) => void): void {
  const go = (n: TreeNode, depth: number): void => {
    visit(n, depth);
    for (const child of n.children ?? []) go(child, depth + 1);
  };
  go(node, 0);
}

/** `itemId -> mode`, first (shallowest) occurrence wins — the mode is decided per item, not per branch. */
export function modesByItem(result: CalcResult): Map<number, Mode> {
  const modes = new Map<number, Mode>();
  walkTree(result.tree, (node) => {
    if (!modes.has(node.itemId)) modes.set(node.itemId, node.mode);
  });
  return modes;
}

/**
 * The shallowest item that is crafted at `low` gold-per-labor and bought at `high` — the subject of
 * the craft→buy flip spec, picked from the data instead of hardcoded.
 *
 * It is chosen from the HIGH tree, so the node is guaranteed to still be rendered after the flip
 * (an item whose parent also flipped disappears from the tree entirely and cannot be asserted on).
 */
export function findFlip(
  base: EngineInputs,
  low: number,
  high: number,
): { itemId: number; name: string } | null {
  const lowModes = modesByItem(expected({ ...base, goldPerLabor: low }));
  const candidates: Array<{ itemId: number; name: string; depth: number }> = [];
  walkTree(expected({ ...base, goldPerLabor: high }).tree, (node, depth) => {
    if (node.mode !== 'buy' || lowModes.get(node.itemId) !== 'craft') return;
    candidates.push({ itemId: node.itemId, name: node.name, depth });
  });
  candidates.sort((a, b) => a.depth - b.depth || a.itemId - b.itemId);
  const best = candidates[0];
  return best ? { itemId: best.itemId, name: best.name } : null;
}
