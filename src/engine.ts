/**
 * AACraft calc engine — pure, DOM-free, fully unit-testable.
 *
 * Semantics are defined by SPEC.md ("Calc engine"). Highlights:
 *  - No RNG: `products[].rate` is ignored upstream; one craft = one result.
 *  - Craft-vs-buy is driven by `goldPerLabor`: a material is crafted only when its recursive
 *    craft cost per unit is strictly cheaper than its (possibly overridden) AH price.
 *  - Quantities aggregate GLOBALLY per item, not per branch: an item used by three different
 *    sub-recipes is needed once, and the integer craft count is computed on that global total.
 */

// ------------------------------------------------------------------ data model

/** One recipe as emitted by `tools/build-data.mjs`. */
export interface Recipe {
  id: number;
  name: string;
  /** `[primaryProductItemId, amountPerCraft]` */
  out: [number, number];
  /** Raw labor cost per craft, before proficiency reduction. */
  labor: number;
  /** Gold crafting fee per craft (the `Coin` material, converted). */
  fee: number;
  /** `[itemId, amountPerCraft][]`, `Coin` excluded. */
  mats: Array<[number, number]>;
}

/** `[itemName, ahPrice | null]` */
export type ItemEntry = [string, number | null];

/** Shape of `public/data.json`. */
export interface DataSet {
  updated: string;
  items: Record<string, ItemEntry>;
  recipes: Recipe[];
}

export type Mode = 'craft' | 'buy';

export interface CalcOptions {
  target: number;
  qty: number;
  /** Gold value of one labor point. Higher => crafting looks more expensive => more buying. */
  goldPerLabor: number;
  /** Max proficiency: effective labor = ceil(labor * 0.7). Defaults to true. */
  profReduction?: boolean;
  /** Per-item unit price replacing the AH price everywhere. */
  priceOverride?: Readonly<Record<number, number>>;
  /** Per-item forced craft/buy decision. */
  modeOverride?: Readonly<Record<number, Mode>>;
  /** Per-item recipe choice, when several recipes make the item. */
  recipeOverride?: Readonly<Record<number, number>>;
}

// --------------------------------------------------------------------- output

/** One aggregated craft, listed bottom-up (deepest sub-crafts first, target last). */
export interface Step {
  recipeId: number;
  recipeName: string;
  itemId: number;
  itemName: string;
  /** `ceil(needed / outAmount)` over the globally aggregated demand. */
  crafts: number;
  /** Units produced per craft. */
  outAmount: number;
  /** Units actually required. */
  needed: number;
  /** `crafts * outAmount`. */
  produced: number;
  /** `produced - needed` — leftovers, since crafts cannot be fractional. */
  surplus: number;
  /** Effective labor for one craft (proficiency applied). */
  laborEach: number;
  laborTotal: number;
  feeTotal: number;
  matsPerCraft: Array<{ itemId: number; name: string; amount: number }>;
}

export interface BuyRow {
  itemId: number;
  name: string;
  qty: number;
  /** Effective unit price; `0` when unknown (see `noPrice`). */
  unitPrice: number;
  total: number;
  /** No AH price and no override — the row is priced at 0 and understated. */
  noPrice: boolean;
  /** The unit price came from `priceOverride`. */
  overridden: boolean;
}

export interface Totals {
  buyGold: number;
  feeGold: number;
  labor: number;
  /**
   * What that labor is worth at `goldPerLabor`. It decides every craft-vs-buy call, but it is
   * NOT part of `grandTotal`: labor is spent, not paid for — you never hand it to anyone.
   */
  laborGold: number;
  /** Gold actually leaving the purse: materials + crafting fees. Labor is deliberately excluded. */
  grandTotal: number;
}

/**
 * Decision tree for display. Quantities here are PER BRANCH; the authoritative aggregated
 * numbers live in `steps` / `buyList` (the same item can appear in several branches).
 */
export interface TreeNode {
  itemId: number;
  name: string;
  mode: Mode;
  /** Units needed on this branch. */
  qty: number;
  unitPrice: number | null;
  /** Recursive per-unit craft cost, when the item is craftable. */
  craftUnitCost: number | null;
  noPrice: boolean;
  priceOverridden: boolean;
  modeOverridden: boolean;
  /** Display only: the item has at least one recipe, so a craft/buy toggle makes sense on it. */
  craftable: boolean;
  /** True when this occurrence was forced to `buy` to break a recipe cycle. */
  cycleBroken: boolean;
  /** Present when several recipes make the item — what the UI's recipe selector offers, on buy
   *  nodes too (picking a cheaper recipe there can flip the decision back to craft). In default
   *  order (`compareRecipes`, the default first); `selected` marks the recipe currently in use;
   *  `labor` is effective (proficiency applied), like every other labor number emitted. */
  recipeOptions?: Array<{ id: number; name: string; out: number; labor: number; selected: boolean }>;
  recipeId?: number;
  recipeName?: string;
  crafts?: number;
  /** Units one craft yields — batch recipes make 10 or 100 at a time, so `crafts` alone
   *  understates what the materials below actually buy. */
  outAmount?: number;
  laborEach?: number;
  children?: TreeNode[];
}

export interface CalcResult {
  steps: Step[];
  buyList: BuyRow[];
  totals: Totals;
  tree: TreeNode;
  /** Set when the target itself is not craftable — the UI should block on this. */
  error?: string;
}

// ------------------------------------------------------------------- indexing

/** Pre-computed lookups over a `DataSet`; build once, reuse across recalcs. */
export interface CraftIndex {
  data: DataSet;
  recipeById: ReadonlyMap<number, Recipe>;
  /** Recipes keyed by the item they produce, the default recipe first (see `compareRecipes`). */
  recipesByProduct: ReadonlyMap<number, Recipe[]>;
  /** `data.items` keyed by numeric id, so lookups need no per-call `String(id)`. */
  entryById: ReadonlyMap<number, ItemEntry>;
}

/** Default-recipe order for one item: biggest batch first (most output per craft — the ×100
 *  "Batch Processing" recipes beat the ×1 ones); ties → lowest labor per output unit, then lowest id. */
function compareRecipes(a: Recipe, b: Recipe): number {
  const oa = outAmount(a);
  const ob = outAmount(b);
  if (oa !== ob) return ob - oa;
  const la = a.labor / oa;
  const lb = b.labor / ob;
  if (la !== lb) return la - lb;
  return a.id - b.id;
}

export function buildIndex(data: DataSet): CraftIndex {
  const recipeById = new Map<number, Recipe>();
  const recipesByProduct = new Map<number, Recipe[]>();
  for (const r of data.recipes) {
    recipeById.set(r.id, r);
    const list = recipesByProduct.get(r.out[0]);
    if (list) list.push(r);
    else recipesByProduct.set(r.out[0], [r]);
  }
  for (const list of recipesByProduct.values()) list.sort(compareRecipes);
  const entryById = new Map<number, ItemEntry>();
  for (const [id, entry] of Object.entries(data.items)) {
    const n = Number(id);
    if (Number.isFinite(n)) entryById.set(n, entry);
  }
  return { data, recipeById, recipesByProduct, entryById };
}

/** Anything the UI lists: a display name plus its numeric id (`id` on search items, `itemId` on rows). */
export interface Named {
  name: string;
  id?: number;
  itemId?: number;
}

/** The one display ordering: by name, ties broken by item id so lists never wobble. */
export function byNameThenId(a: Named, b: Named): number {
  return a.name.localeCompare(b.name) || (a.id ?? a.itemId ?? 0) - (b.id ?? b.itemId ?? 0);
}

export function itemName(index: CraftIndex, itemId: number): string {
  return index.entryById.get(itemId)?.[0] ?? `Item ${itemId}`;
}

export function itemPrice(index: CraftIndex, itemId: number): number | null {
  return index.entryById.get(itemId)?.[1] ?? null;
}

/** Effective labor for one craft. `ceil(labor * 0.7)`, computed as `ceil(labor * 7 / 10)` so that
 *  floating point cannot round 455 up to 456. */
export function effectiveLabor(labor: number, profReduction: boolean): number {
  if (!profReduction) return labor;
  return Math.ceil((labor * 7) / 10);
}

/** Units produced by one craft (a recipe never yields less than one). */
function outAmount(r: Recipe): number {
  return Math.max(1, r.out[1]);
}

/** Whole crafts needed to obtain `units` output units — surplus is fine, fractions are not. */
function craftsFor(r: Recipe, units: number): number {
  return ceilQty(units / outAmount(r));
}

// ------------------------------------------------------------------- resolving

interface Resolved {
  mode: Mode;
  /** Gold cost of obtaining one unit under the chosen mode. */
  unitCost: number;
  /** Effective price (override first, then AH), or null when unknown. */
  unitPrice: number | null;
  craftUnitCost: number | null;
  recipe: Recipe | null;
  noPrice: boolean;
  priceOverridden: boolean;
  modeOverridden: boolean;
}

class Calculator {
  private readonly index: CraftIndex;
  /** Sanitized once here; `calculate` reuses it for the labor→gold total. */
  readonly goldPerLabor: number;
  private readonly profReduction: boolean;
  private readonly priceOverride: Readonly<Record<number, number>>;
  private readonly modeOverride: Readonly<Record<number, Mode>>;
  private readonly recipeOverride: Readonly<Record<number, number>>;

  private readonly memo = new Map<number, Resolved>();
  private readonly resolving = new Set<number>();

  constructor(index: CraftIndex, opts: CalcOptions) {
    this.index = index;
    this.goldPerLabor = Number.isFinite(opts.goldPerLabor) ? opts.goldPerLabor : 0;
    this.profReduction = opts.profReduction ?? true;
    this.priceOverride = opts.priceOverride ?? {};
    this.modeOverride = opts.modeOverride ?? {};
    this.recipeOverride = opts.recipeOverride ?? {};
  }

  /** Effective unit price: user override wins over the AH price. */
  price(itemId: number): { price: number | null; overridden: boolean } {
    const ov = this.priceOverride[itemId];
    if (ov !== undefined && Number.isFinite(ov) && ov >= 0) return { price: ov, overridden: true };
    return { price: itemPrice(this.index, itemId), overridden: false };
  }

  /** The recipe used for an item: explicit override, else the biggest-batch default. */
  recipeFor(itemId: number): Recipe | null {
    const ovId = this.recipeOverride[itemId];
    if (ovId !== undefined) {
      const r = this.index.recipeById.get(ovId);
      // Only honour an override that actually produces the item; otherwise fall through.
      if (r && r.out[0] === itemId) return r;
    }
    return this.index.recipesByProduct.get(itemId)?.[0] ?? null;
  }

  labor(recipe: Recipe): number {
    return effectiveLabor(recipe.labor, this.profReduction);
  }

  private buyOnly(price: number | null, overridden: boolean, modeOverridden: boolean): Resolved {
    return {
      mode: 'buy',
      unitCost: price ?? 0,
      unitPrice: price,
      craftUnitCost: null,
      recipe: null,
      noPrice: price === null,
      priceOverridden: overridden,
      modeOverridden,
    };
  }

  /**
   * Decide craft-vs-buy for one item and price a single unit of it.
   * Memoized per item; re-entering an item that is still being resolved (a recipe cycle) yields a
   * non-memoized "buy" so the recursion always terminates.
   */
  resolve(itemId: number): Resolved {
    const hit = this.memo.get(itemId);
    if (hit) return hit;
    if (this.resolving.has(itemId)) {
      const cyclic = this.price(itemId);
      return this.buyOnly(cyclic.price, cyclic.overridden, false);
    }

    const recipe = this.recipeFor(itemId);
    // A mode override on an item with no recipe means nothing — it can only ever be bought.
    const forced = recipe ? this.modeOverride?.[itemId] : undefined;
    const { price, overridden } = this.price(itemId);

    if (!recipe || forced === 'buy') {
      const res = this.buyOnly(price, overridden, forced !== undefined);
      this.memo.set(itemId, res);
      return res;
    }

    this.resolving.add(itemId);
    let matCost = 0;
    for (const [matId, amount] of recipe.mats) matCost += this.resolve(matId).unitCost * amount;
    this.resolving.delete(itemId);

    const craftUnitCost =
      (matCost + recipe.fee + this.labor(recipe) * this.goldPerLabor) / outAmount(recipe);

    // Craft only when strictly cheaper than buying. No price at all => nothing to buy => craft.
    const craft = forced === 'craft' || price === null || craftUnitCost < price;

    const res: Resolved = {
      mode: craft ? 'craft' : 'buy',
      unitCost: craft ? craftUnitCost : price,
      unitPrice: price,
      craftUnitCost,
      recipe,
      noPrice: price === null,
      priceOverridden: overridden,
      modeOverridden: forced !== undefined,
    };
    this.memo.set(itemId, res);
    return res;
  }
}

// ------------------------------------------------------------------ expansion

interface CraftNode {
  recipe: Recipe;
  /** Material ids on this recipe that must be bought here because they close a cycle. */
  cycleBroken: Set<number>;
}

const EPSILON = 1e-9;

/** `ceil` that tolerates the float noise from `needed` sums (e.g. 3.0000000000000004 -> 3). */
function ceilQty(n: number): number {
  const c = Math.ceil(n - EPSILON);
  return c < 0 ? 0 : c;
}

/**
 * Compute the full breakdown for `qty` of `target`.
 *
 * @throws never — an uncraftable target is reported through `result.error`.
 */
export function calculate(index: CraftIndex, opts: CalcOptions): CalcResult {
  const calc = new Calculator(index, opts);
  const qty = Number.isFinite(opts.qty) && opts.qty > 0 ? opts.qty : 0;

  const targetRecipe = calc.recipeFor(opts.target);

  // ---- pass 1: walk the decision graph, collecting the set of crafted items ------------------
  const craftNodes = new Map<number, CraftNode>();
  const path = new Set<number>();

  const visit = (itemId: number, isTarget: boolean): void => {
    if (craftNodes.has(itemId)) return;
    const res = calc.resolve(itemId);
    // The target is always crafted (SPEC), regardless of what it costs on the AH.
    const recipe = isTarget ? targetRecipe : res.mode === 'craft' ? res.recipe : null;
    if (!recipe) return;

    const node: CraftNode = { recipe, cycleBroken: new Set() };
    craftNodes.set(itemId, node);
    path.add(itemId);
    for (const [matId] of recipe.mats) {
      if (path.has(matId)) node.cycleBroken.add(matId); // inner occurrence of a cycle -> buy
      else visit(matId, false);
    }
    path.delete(itemId);
  };

  if (targetRecipe) visit(opts.target, true);

  // ---- pass 2: topological order so demand is complete before we round up crafts -------------
  // Edge item -> material means the item must be processed first. Kahn over craft nodes only,
  // ignoring cycle-broken edges (those materials are bought, not crafted, at that point).
  const consumers = new Map<number, number>(); // in-degree: how many craft nodes consume this item
  for (const id of craftNodes.keys()) consumers.set(id, 0);
  /** Distinct craft-node materials of a recipe, cycle-broken edges excluded. */
  const craftDeps = (node: CraftNode): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const [matId] of node.recipe.mats) {
      if (node.cycleBroken.has(matId) || !craftNodes.has(matId) || seen.has(matId)) continue;
      seen.add(matId);
      out.push(matId);
    }
    return out;
  };

  // Materialized once: the Kahn loops below walk the same edges twice.
  const deps = new Map<number, number[]>();
  for (const [id, node] of craftNodes) deps.set(id, craftDeps(node));

  for (const list of deps.values()) {
    for (const matId of list) consumers.set(matId, (consumers.get(matId) ?? 0) + 1);
  }
  const queue: number[] = [];
  for (const [id, deg] of consumers) if (deg === 0) queue.push(id);
  queue.sort((a, b) => a - b); // deterministic tie-breaking

  const order: number[] = [];
  let cursor = 0;
  while (cursor < queue.length) {
    const id = queue[cursor++] as number;
    order.push(id);
    const list = deps.get(id);
    if (!list) continue;
    for (const matId of list) {
      const deg = (consumers.get(matId) ?? 0) - 1;
      consumers.set(matId, deg);
      if (deg === 0) queue.push(matId);
    }
  }
  // Defensive: pass 1 removes every back edge, so the remaining graph is a DAG and this is dead
  // code. Kept so a future change cannot silently drop demand.
  if (order.length < craftNodes.size) {
    const ordered = new Set(order);
    for (const id of craftNodes.keys()) if (!ordered.has(id)) order.push(id);
  }

  // ---- pass 3: aggregate demand top-down, then emit steps ------------------------------------
  const need = new Map<number, number>();
  const buyQty = new Map<number, number>();
  const steps: Step[] = [];

  if (targetRecipe && qty > 0) need.set(opts.target, qty);

  for (const itemId of order) {
    const node = craftNodes.get(itemId);
    if (!node) continue;
    const needed = need.get(itemId) ?? 0;
    if (needed <= 0) continue;

    const recipe = node.recipe;
    const out = outAmount(recipe);
    const crafts = craftsFor(recipe, needed);
    const laborEach = calc.labor(recipe);

    steps.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      itemId,
      itemName: itemName(index, itemId),
      crafts,
      outAmount: out,
      needed,
      produced: crafts * out,
      surplus: crafts * out - needed,
      laborEach,
      laborTotal: laborEach * crafts,
      feeTotal: recipe.fee * crafts,
      matsPerCraft: recipe.mats.map(([matId, amount]) => ({
        itemId: matId,
        name: itemName(index, matId),
        amount,
      })),
    });

    for (const [matId, amount] of recipe.mats) {
      const want = crafts * amount;
      if (!node.cycleBroken.has(matId) && craftNodes.has(matId)) {
        need.set(matId, (need.get(matId) ?? 0) + want);
      } else {
        buyQty.set(matId, (buyQty.get(matId) ?? 0) + want);
      }
    }
  }

  // Bottom-up: deepest sub-crafts first, the target last.
  steps.reverse();

  // ---- buy list, totals ----------------------------------------------------------------------
  const buyList: BuyRow[] = [];
  for (const [itemId, q] of buyQty) {
    if (q <= 0) continue;
    const res = calc.resolve(itemId);
    const unitPrice = res.unitPrice ?? 0;
    buyList.push({
      itemId,
      name: itemName(index, itemId),
      qty: q,
      unitPrice,
      total: unitPrice * q,
      noPrice: res.unitPrice === null,
      overridden: res.priceOverridden,
    });
  }
  buyList.sort((a, b) => b.total - a.total || byNameThenId(a, b));

  let buyGold = 0;
  for (const row of buyList) buyGold += row.total;
  let feeGold = 0;
  let labor = 0;
  for (const s of steps) {
    feeGold += s.feeTotal;
    labor += s.laborTotal;
  }
  const laborGold = labor * calc.goldPerLabor;

  const totals: Totals = {
    buyGold,
    feeGold,
    labor,
    laborGold,
    // Labor is not gold you pay out — it only prices the craft-vs-buy choice above.
    grandTotal: buyGold + feeGold,
  };

  const result: CalcResult = {
    steps,
    buyList,
    totals,
    tree: buildTree(index, calc, targetRecipe, opts.target, qty),
  };
  if (!targetRecipe) {
    result.error = `${itemName(index, opts.target)} (${opts.target}) has no recipe — it cannot be crafted.`;
  }
  return result;
}

/** Per-branch display tree. Node budget guards against pathological graphs. */
function buildTree(
  index: CraftIndex,
  calc: Calculator,
  targetRecipe: Recipe | null,
  target: number,
  qty: number,
  maxNodes = 20000,
): TreeNode {
  let budget = maxNodes;

  const make = (itemId: number, units: number, forceCraft: boolean, onPath: Set<number>): TreeNode => {
    const res = calc.resolve(itemId);
    const node: TreeNode = {
      itemId,
      name: itemName(index, itemId),
      mode: 'buy',
      qty: units,
      unitPrice: res.unitPrice,
      craftUnitCost: res.craftUnitCost,
      noPrice: res.unitPrice === null,
      priceOverridden: res.priceOverridden,
      modeOverridden: res.modeOverridden,
      craftable: index.recipesByProduct.has(itemId),
      cycleBroken: false,
    };

    const options = index.recipesByProduct.get(itemId);
    if (options && options.length > 1) {
      const active = calc.recipeFor(itemId);
      node.recipeOptions = options.map((r) => ({
        id: r.id,
        name: r.name,
        out: outAmount(r),
        labor: calc.labor(r),
        selected: r.id === active?.id,
      }));
    }

    // The target (forceCraft) is always crafted, per SPEC; everything else follows the decision.
    const recipe = forceCraft ? targetRecipe : res.mode === 'craft' ? res.recipe : null;
    if (!recipe) return node;
    if (onPath.has(itemId) || budget <= 0) {
      node.cycleBroken = true;
      return node;
    }

    const crafts = craftsFor(recipe, units);
    node.mode = 'craft';
    node.recipeId = recipe.id;
    node.recipeName = recipe.name;
    node.crafts = crafts;
    node.outAmount = outAmount(recipe);
    node.laborEach = calc.labor(recipe);

    onPath.add(itemId);
    const children: TreeNode[] = [];
    for (const [matId, amount] of recipe.mats) {
      budget--;
      children.push(make(matId, crafts * amount, false, onPath));
    }
    onPath.delete(itemId);
    node.children = children;
    return node;
  };

  return make(target, qty, targetRecipe !== null, new Set());
}
