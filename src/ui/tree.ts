/** Collapsible craft/buy decision tree. */
import type { Mode, TreeNode } from '../engine';
import { clear, el, gold, int, price } from './dom';

export interface TreeHandlers {
  /** Expanded craft nodes, keyed by item id so the state survives a recalc. */
  expanded: Set<number>;
  /** True when the item has at least one recipe (a forced-buy node has no recipe in the result). */
  canCraft: (itemId: number) => boolean;
  /** Current per-item override, so an active toggle can be un-set back to "auto". */
  modeOverrideOf: (itemId: number) => Mode | undefined;
  onToggleExpand: (itemId: number) => void;
  onSetMode: (itemId: number, mode: Mode | null) => void;
}

const MAX_DEPTH = 40;

export function renderTree(container: HTMLElement, root: TreeNode, h: TreeHandlers): void {
  clear(container);
  container.appendChild(nodeEl(root, h, true, 0));
}

function badge(text: string, kind: string): HTMLElement {
  return el('span', { className: `badge badge-${kind}`, text, testid: `badge-${kind}` });
}

function nodeEl(node: TreeNode, h: TreeHandlers, isRoot: boolean, depth: number): HTMLElement {
  const hasChildren = (node.children?.length ?? 0) > 0 && depth < MAX_DEPTH;
  const expanded = hasChildren && h.expanded.has(node.itemId);

  const row = el('div', { className: 'node-row' });

  if (hasChildren) {
    const twisty = el('button', {
      className: 'twisty',
      text: expanded ? '▾' : '▸',
      testid: 'tree-toggle',
      attrs: { type: 'button', 'aria-expanded': String(expanded), 'data-item-id': String(node.itemId) },
    });
    twisty.addEventListener('click', () => h.onToggleExpand(node.itemId));
    row.appendChild(twisty);
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
  if (node.noPrice && node.mode === 'buy') row.appendChild(badge('no price', 'noprice'));
  if (node.cycleBroken) row.appendChild(badge('cycle → buy', 'cycle'));
  if (node.priceOverridden) row.appendChild(badge('price set', 'override'));
  if (node.modeOverridden) row.appendChild(badge('forced', 'override'));

  // The target is always crafted (SPEC), and an item with no recipe can only ever be bought.
  if (!isRoot && h.canCraft(node.itemId)) {
    const current = h.modeOverrideOf(node.itemId);
    const group = el('span', { className: 'mode-toggle', testid: 'node-mode' });
    for (const mode of ['craft', 'buy'] as const) {
      const btn = el('button', {
        className: `mode-btn${node.mode === mode ? ' on' : ''}`,
        text: mode === 'craft' ? 'Craft' : 'Buy',
        testid: `node-mode-${mode}`,
        attrs: {
          type: 'button',
          'data-item-id': String(node.itemId),
          'aria-pressed': String(current === mode),
          title:
            current === mode
              ? 'Forced — click again to return to automatic'
              : `Force ${mode} for this item`,
        },
      });
      // Clicking the active override clears it, so there is always a way back to "auto".
      btn.addEventListener('click', () => h.onSetMode(node.itemId, current === mode ? null : mode));
      group.appendChild(btn);
    }
    row.appendChild(group);
  }

  const wrap = el('div', {
    className: `node node-${node.mode}`,
    testid: 'tree-node',
    attrs: {
      'data-item-id': String(node.itemId),
      'data-mode': node.mode,
      ...(node.cycleBroken ? { 'data-cycle': 'true' } : {}),
      ...(node.noPrice ? { 'data-noprice': 'true' } : {}),
    },
    children: [row],
  });

  if (expanded && node.children) {
    const kids = el('div', { className: 'node-children' });
    for (const child of node.children) kids.appendChild(nodeEl(child, h, false, depth + 1));
    wrap.appendChild(kids);
  }
  return wrap;
}
