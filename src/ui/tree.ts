/**
 * Collapsible craft/buy decision tree.
 *
 * Painting only: the twisties and the craft/buy toggles carry `data-item-id`, and `main.ts` handles
 * their clicks with one delegated listener on the container.
 */
import type { TreeNode } from '../engine';
import { badge, clear, el, gold, int, price, setFlags } from './dom';

/** Test id of the expand/collapse twisty — the anchor for the delegated click handler. */
export const TREE_TOGGLE = 'tree-toggle';
/** Class of the craft/buy buttons; each carries `data-item-id` and `data-mode`. */
export const MODE_BTN = 'mode-btn';

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
    row.appendChild(
      el('span', {
        className: 'node-detail',
        testid: 'node-detail',
        text: `${int(crafts)} craft${crafts === 1 ? '' : 's'} × ${int(laborEach)} labor = ${int(crafts * laborEach)} labor`,
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

  // A crafted item without an AH price is normal (that is *why* it is crafted); the flag only
  // matters where a missing price understates the bill — on a bought node.
  if (node.noPrice && node.mode === 'buy') row.appendChild(badge('noprice', 'no price'));
  if (node.cycleBroken) row.appendChild(badge('cycle', 'cycle → buy'));
  if (node.priceOverridden) row.appendChild(badge('override', 'price set'));
  if (node.modeOverridden) row.appendChild(badge('override', 'forced'));

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
