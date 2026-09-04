/** Tiny DOM + formatting helpers. No framework, no dependencies. */

/** `document.querySelector` that throws instead of returning null (all markup is in index.html). */
export function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return el;
}

interface ElOptions {
  className?: string;
  text?: string;
  testid?: string;
  attrs?: Record<string, string>;
  children?: Node[];
}

/** Create an element: `el('span', { className: 'badge', text: 'no price' })`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.testid) node.dataset['testid'] = opts.testid;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v);
  for (const child of opts.children ?? []) node.appendChild(child);
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** The one badge shape, used by the tree and the buy list: `.badge.badge-<kind>` + a matching testid. */
export function badge(kind: string, text: string): HTMLElement {
  return el('span', { className: `badge badge-${kind}`, text, testid: `badge-${kind}` });
}

/**
 * The one encoding for boolean display flags: `data-<name>="true"` when on, attribute absent when
 * off. CSS styles them through attribute selectors, so nothing needs a parallel class.
 */
export function setFlags(node: Element, flags: Record<string, boolean>): void {
  for (const [name, on] of Object.entries(flags)) {
    if (on) node.setAttribute(`data-${name}`, 'true');
    else node.removeAttribute(`data-${name}`);
  }
}

const GOLD_FMT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const INT_FMT = new Intl.NumberFormat('en-US');
const PRICE_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** `1234.5 -> "1,234.50g"` — the single gold format used everywhere in the UI. */
export function gold(n: number): string {
  return `${GOLD_FMT.format(n)}g`;
}

/** Counts / labor points: thousands separators, no decimals. */
export function int(n: number): string {
  return INT_FMT.format(n);
}

/**
 * Unit prices inside table cells / tree rows: up to 2 decimals, no trailing zeroes (`5.87g`, `10g`).
 * The prices in the data are already rounded to two by `tools/build-data.mjs` — deliberately, so
 * that the number shown and the number multiplied out are the same one. This only formats.
 */
export function price(n: number): string {
  return `${PRICE_FMT.format(n)}g`;
}

/**
 * Value prefilled into an editable price input — plain number, no grouping. Four decimals, not two
 * like `price()`: this echoes a value back into a field the user may have typed, and rewriting
 * their 5.8791 as 5.88 while the engine still charges 5.8791 would be the mismatch that rounding
 * the data exists to avoid. AH prices reach it already rounded, so it prints two in practice.
 */
export function priceInputValue(n: number): string {
  return String(Number(n.toFixed(4)));
}

/**
 * How a batch size is spelled: `10 -> "10x"`. One definition, because four places show it and they
 * must not drift: the target heading (`main.ts`), the tree node tag and the recipe `<option>`
 * labels (`ui/tree.ts`), and the search popup row (`ui/search.ts`).
 */
export function batchLabel(out: number): string {
  return `${int(out)}x`;
}

/**
 * The one batch-tag span, used wherever an item name is shown next to the size of the batch its
 * recipe makes. One class and one testid, like `badge`, so a caller cannot invent a second
 * spelling; `suffix` is for the target heading, which needs "per craft" to stay unambiguous.
 */
export function batchTag(out: number, suffix = ''): HTMLElement {
  return el('span', {
    className: 'batch-tag',
    testid: 'batch-tag',
    text: batchLabel(out) + suffix,
  });
}
