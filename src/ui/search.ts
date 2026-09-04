/** Item search: substring match over craftable items with a keyboard-navigable popup. */
import { byNameThenId, defaultRecipe, itemName, outAmount, type CraftIndex } from '../engine';
import { batchLabel, clear, el } from './dom';

export interface SearchItem {
  id: number;
  name: string;
  lower: string;
  /**
   * Units the item's default recipe makes at once. Deliberately kept out of `name`: the name is
   * what the query matches and what the input is filled with on pick, and "Alluvion Love 10x"
   * would match nothing on a re-search.
   */
  out: number;
}

/** Longest popup the SPEC allows; also the only cap the matcher needs. */
export const MAX_ROWS = 50;

/** Every item that at least one recipe produces, sorted by name — the only searchable set. */
export function buildSearchItems(index: CraftIndex): SearchItem[] {
  const items: SearchItem[] = [];
  for (const itemId of index.recipesByProduct.keys()) {
    const name = itemName(index, itemId);
    const recipe = defaultRecipe(index, itemId);
    items.push({
      id: itemId,
      name,
      lower: name.toLowerCase(),
      out: recipe ? outAmount(recipe) : 1,
    });
  }
  items.sort(byNameThenId);
  return items;
}

/**
 * Substring match, earliest hit first (so a prefix match outranks a mid-word one), then by name.
 *
 * `items` is already in name order, so bucketing by hit position and concatenating the buckets in
 * order reproduces that ranking without sorting the (up to ~7 000) matches of a one-letter query.
 */
export function search(items: readonly SearchItem[], query: string): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const buckets: SearchItem[][] = [];
  for (const item of items) {
    const at = item.lower.indexOf(q);
    if (at < 0) continue;
    const bucket = (buckets[at] ??= []);
    // Nothing past the MAX_ROWS-th name of a bucket can reach the top rows, and once the best
    // possible bucket is full no later item can either.
    if (bucket.length < MAX_ROWS) bucket.push(item);
    if ((buckets[0]?.length ?? 0) >= MAX_ROWS) break;
  }

  const out: SearchItem[] = [];
  for (const bucket of buckets) {
    if (!bucket) continue; // sparse: no match started at this offset
    for (const item of bucket) {
      out.push(item);
      if (out.length === MAX_ROWS) return out;
    }
  }
  return out;
}

export interface SearchOptions {
  input: HTMLInputElement;
  popup: HTMLElement;
  items: readonly SearchItem[];
  onPick: (item: SearchItem) => void;
}

export function initSearch(opts: SearchOptions): void {
  const { input, popup, items, onPick } = opts;
  let matches: SearchItem[] = [];
  let active = -1;

  const close = (): void => {
    popup.hidden = true;
    clear(popup);
    matches = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
  };

  /** Move the highlight after an arrow key — the rows themselves do not change. */
  const paint = (): void => {
    const rows = Array.from(popup.children) as HTMLElement[];
    rows.forEach((row, i) => {
      row.classList.toggle('active', i === active);
      row.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    if (active >= 0) rows[active]?.scrollIntoView({ block: 'nearest' });
  };

  const open = (): void => {
    matches = search(items, input.value);
    if (matches.length === 0) {
      close();
      return;
    }
    active = 0;

    const frag = document.createDocumentFragment();
    matches.forEach((item, i) => {
      const row = el('div', {
        className: i === active ? 'popup-row active' : 'popup-row',
        testid: 'search-option',
        attrs: {
          role: 'option',
          'aria-selected': String(i === active),
          'data-item-id': String(item.id),
        },
        children: [
          el('span', { className: 'popup-name', text: item.name }),
          // Same tag as the tree node and the heading: a batch item is worth knowing about before
          // you pick it, since asking for 1 buys reagents for the whole batch.
          ...(item.out > 1
            ? [el('span', { className: 'batch-tag', testid: 'popup-batch', text: batchLabel(item.out) })]
            : []),
          el('span', { className: 'popup-id', text: `· ${item.id}` }),
        ],
      });
      // mousedown fires before the input's blur, so the pick is not lost to `close()`.
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        pick(item);
      });
      frag.appendChild(row);
    });
    popup.replaceChildren(frag);
    popup.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const pick = (item: SearchItem): void => {
    input.value = item.name;
    close();
    onPick(item);
  };

  input.addEventListener('input', open);
  input.addEventListener('focus', () => {
    if (input.value.trim()) open();
  });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      close();
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (popup.hidden) {
        open();
        return;
      }
      ev.preventDefault();
      const delta = ev.key === 'ArrowDown' ? 1 : -1;
      active = (active + delta + matches.length) % matches.length;
      paint();
      return;
    }
    if (ev.key === 'Enter') {
      const item = matches[active];
      if (!popup.hidden && item) {
        ev.preventDefault();
        pick(item);
      }
    }
  });
}
