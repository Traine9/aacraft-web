/** Item search: substring match over craftable items with a keyboard-navigable popup. */
import type { CraftIndex } from '../engine';
import { clear, el } from './dom';

export interface SearchItem {
  id: number;
  name: string;
  lower: string;
}

const MAX_ROWS = 50;

/** Every item that at least one recipe produces, sorted by name — the only searchable set. */
export function buildSearchItems(index: CraftIndex): SearchItem[] {
  const items: SearchItem[] = [];
  for (const itemId of index.recipesByProduct.keys()) {
    const name = index.entryById.get(itemId)?.[0] ?? `Item ${itemId}`;
    items.push({ id: itemId, name, lower: name.toLowerCase() });
  }
  items.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return items;
}

/** Substring match, earliest hit first (so a prefix match outranks a mid-word one). */
export function search(items: readonly SearchItem[], query: string, limit = MAX_ROWS): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Array<{ item: SearchItem; at: number }> = [];
  for (const item of items) {
    const at = item.lower.indexOf(q);
    if (at >= 0) hits.push({ item, at });
  }
  hits.sort((a, b) => a.at - b.at || a.item.name.localeCompare(b.item.name) || a.item.id - b.item.id);
  return hits.slice(0, limit).map((h) => h.item);
}

export interface SearchOptions {
  input: HTMLInputElement;
  popup: HTMLElement;
  items: readonly SearchItem[];
  onPick: (item: SearchItem) => void;
}

export interface SearchHandle {
  /** Set the text without opening the popup (used by the preset buttons). */
  setValue: (value: string) => void;
}

export function initSearch(opts: SearchOptions): SearchHandle {
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
    clear(popup);
    if (matches.length === 0) {
      close();
      return;
    }
    for (const item of matches) {
      const row = el('div', {
        className: 'popup-row',
        testid: 'search-option',
        attrs: { role: 'option', 'data-item-id': String(item.id) },
        children: [
          el('span', { className: 'popup-name', text: item.name }),
          el('span', { className: 'popup-id', text: `· ${item.id}` }),
        ],
      });
      // mousedown fires before the input's blur, so the pick is not lost to `close()`.
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        pick(item);
      });
      popup.appendChild(row);
    }
    active = 0;
    popup.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    paint();
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

  return {
    setValue: (value: string) => {
      input.value = value;
      close();
    },
  };
}
