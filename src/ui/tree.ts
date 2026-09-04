/**
 * Collapsible craft/buy decision tree.
 *
 * Painting only: the twisties and the craft/buy toggles carry `data-item-id`, and `main.ts` handles
 * their clicks with one delegated listener on the container.
 */
import type { TreeNode } from '../engine';
import { badge, batchLabel, batchTag, clear, el, gold, int, price, setFlags } from './dom';

/** Test id of the expand/collapse twisty — the anchor for the delegated click handler. */
export const TREE_TOGGLE = 'tree-toggle';
/** Class of the craft/buy buttons; each carries `data-item-id` and `data-mode`. */
export const MODE_BTN = 'mode-btn';
/** Test id of the recipe `<select>` on multi-recipe craft nodes; carries `data-item-id`,
 *  option values are recipe ids. `main.ts` handles its `change` with a delegated listener. */
export const RECIPE_SELECT = 'recipe-select';

/**
 * A recipe name with its batch size appended — unless the name already carries it. Many recipe
 * names in the dump end in their own batch suffix ("Mass Production: Hereafter x1000"), and
 * appending blindly produced "…x1000 1,000x". Matches the suffix in the raw form the data uses
 * (`x1000`, not the grouped `1,000x` this UI renders), which is why it cannot use `batchLabel`.
 */
function optionLabel(name: string, out: number): string {
  if (out <= 1) return name;
  return new RegExp(`\\bx\\s*${out}\\b`, 'i').test(name) ? name : `${name} ${batchLabel(out)}`;
}

/** @param expanded item ids of the open craft nodes — view state that survives a recalc. */
export function renderTree(container: HTMLElement, root: TreeNode, expanded: ReadonlySet<number>): void {
  clear(container);
  container.appendChild(nodeEl(root, expanded, 0));
}

function nodeEl(node: TreeNode, expandedIds: ReadonlySet<number>, depth: number): HTMLElement {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const expanded = hasChildren && expandedIds.has(node.itemId);

  const row = el('div', { className: 'node-row' });

  if (hasChildren) {
    row.appendChild(
      el('button', {
        className: 'twisty',
        text: expanded ? '▾' : '▸',
        testid: TREE_TOGGLE,
        attrs: {
          type: 'button',
          'aria-expanded': String(expanded),
          'data-item-id': String(node.itemId),
        },
      }),
    );
  } else {
    row.appendChild(el('span', { className: 'twisty twisty-leaf', text: '·' }));
  }

  row.appendChild(el('span', { className: 'node-name', text: node.name }));

  if (node.mode === 'craft') {
    const crafts = node.crafts ?? 0;
    const laborEach = node.laborEach ?? 0;
    const out = node.outAmount ?? 1;
    const produced = crafts * out;
    // Batch recipes are part of the item's identity here — "Fine Lumber 10x" reads as one label.
    // Kept out of `.node-name` so the name span stays the bare item name. No "per craft" suffix
    // is needed (unlike the target heading): a node has no quantity multiplier in front of it.
    if (out > 1) row.appendChild(batchTag(out));
    row.appendChild(
      el('span', {
        className: 'node-detail',
        testid: 'node-detail',
        text: `${int(crafts)} craft${crafts === 1 ? '' : 's'} × ${int(laborEach)} labor = ${int(crafts * laborEach)} labor`,
      }),
    );
    // Batch recipes make 10 or 100 units at a time. Without this the materials below look
    // inexplicable: one craft of Kraken's Might buys reagents for a hundred of them. The batch
    // size itself is already on the name tag, so this line only says what it adds up to.
    if (out > 1) {
      row.appendChild(
        el('span', {
          className: 'node-yield',
          testid: 'node-yield',
          text: `→ ${int(produced)} for ${int(node.qty)} needed`,
        }),
      );
    }
    // Whole crafts only, so a batch recipe overshoots — and the overshoot is paid for in full.
    if (produced > node.qty) row.appendChild(badge('surplus', `+${int(produced - node.qty)} spare`));
    // What this branch costs. A buy node states its gold on the detail line above; a craft node's
    // gold is the sum of its ingredients (and their fees) all the way down, which is otherwise
    // invisible until you expand it. Labor is NOT in here, so the target's figure is the grand
    // total the buy list foots — surplus from whole crafts included.
    row.appendChild(
      el('span', {
        className: 'node-gold',
        testid: 'node-gold',
        attrs: { title: 'Materials and crafting fees for this branch — labor not included' },
        text: gold(node.branchGold),
      }),
    );
  } else {
    const unit = node.unitPrice ?? 0;
    row.appendChild(
      el('span', {
        className: 'node-detail',
        testid: 'node-detail',
        text: `${int(node.qty)} × ${price(unit)} = ${gold(unit * node.qty)}`,
      }),
    );
  }

  // Several recipes make this item — let the user pick which one to use. Rendered on buy nodes
  // too: switching to a cheaper recipe there can flip the decision back to craft.
  if (node.recipeOptions) {
    row.appendChild(
      el('select', {
        className: 'recipe-select',
        testid: RECIPE_SELECT,
        attrs: { 'data-item-id': String(node.itemId), title: 'Recipe — this item can be crafted several ways' },
        children: node.recipeOptions.map((opt) =>
          el('option', {
            text: `${optionLabel(opt.name, opt.out)} (${int(opt.labor)} labor)`,
            attrs: { value: String(opt.id), ...(opt.selected ? { selected: '' } : {}) },
          }),
        ),
      }),
    );
  }

  // A crafted item without an AH price is normal (that is *why* it is crafted); the flag only
  // matters where a missing price understates the bill — on a bought node.
  if (node.noPrice && node.mode === 'buy') row.appendChild(badge('noprice', 'no price'));
  if (node.cycleBroken) row.appendChild(badge('cycle', 'cycle → buy'));
  // Price and mode overrides are independent — a node can carry both badges. The third override,
  // the recipe choice, needs none: its select shows the non-default pick on its face.
  if (node.priceOverridden) row.appendChild(badge('price-override', 'price set'));
  if (node.modeOverridden) row.appendChild(badge('mode-forced', 'forced'));

  // The target (depth 0) is always crafted (SPEC), and an item with no recipe can only be bought.
  if (depth > 0 && node.craftable) {
    // The engine only reports `modeOverridden` on the mode it settled on, so that is the forced one.
    const forced = node.modeOverridden ? node.mode : undefined;
    const group = el('span', { className: 'mode-toggle', testid: 'node-mode' });
    for (const mode of ['craft', 'buy'] as const) {
      group.appendChild(
        el('button', {
          className: `${MODE_BTN}${node.mode === mode ? ' on' : ''}`,
          text: mode === 'craft' ? 'Craft' : 'Buy',
          testid: `node-mode-${mode}`,
          attrs: {
            type: 'button',
            'data-item-id': String(node.itemId),
            'data-mode': mode,
            // Clicking the pressed button clears the override, so there is always a way to "auto".
            'aria-pressed': String(forced === mode),
            title:
              forced === mode
                ? 'Forced — click again to return to automatic'
                : `Force ${mode} for this item`,
          },
        }),
      );
    }
    row.appendChild(group);
  }

  const wrap = el('div', {
    className: `node node-${node.mode}`,
    testid: 'tree-node',
    attrs: { 'data-item-id': String(node.itemId), 'data-mode': node.mode },
    children: [row],
  });
  setFlags(wrap, { cycle: node.cycleBroken, noprice: node.noPrice });

  if (expanded && node.children) {
    const kids = el('div', { className: 'node-children' });
    for (const child of node.children) kids.appendChild(nodeEl(child, expandedIds, depth + 1));
    wrap.appendChild(kids);
  }
  return wrap;
}
