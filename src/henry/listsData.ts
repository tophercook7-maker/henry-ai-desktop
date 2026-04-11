export interface ListItem {
  id: string;
  text: string;
  done: boolean;
  addedAt: string;
}

export interface HenryList {
  id: string;
  name: string;
  icon: string;
  items: ListItem[];
  createdAt: string;
}

const KEY = 'henry:lists';

const DEFAULT_LISTS: HenryList[] = [
  { id: 'grocery', name: 'Grocery', icon: '🛒', items: [], createdAt: new Date().toISOString() },
  { id: 'hardware', name: 'Hardware Store', icon: '🔩', items: [], createdAt: new Date().toISOString() },
  { id: 'household', name: 'Household', icon: '🏠', items: [], createdAt: new Date().toISOString() },
  { id: 'ideas', name: 'Ideas', icon: '💡', items: [], createdAt: new Date().toISOString() },
];

export function loadLists(): HenryList[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      localStorage.setItem(KEY, JSON.stringify(DEFAULT_LISTS));
      return DEFAULT_LISTS;
    }
    return JSON.parse(raw);
  } catch { return DEFAULT_LISTS; }
}

function save(lists: HenryList[]) { localStorage.setItem(KEY, JSON.stringify(lists)); }

export function saveList(list: HenryList) {
  const all = loadLists();
  const idx = all.findIndex((l) => l.id === list.id);
  if (idx >= 0) all[idx] = list; else all.push(list);
  save(all);
}

export function deleteList(id: string) { save(loadLists().filter((l) => l.id !== id)); }

export function addItemToList(listId: string, text: string) {
  const all = loadLists();
  const list = all.find((l) => l.id === listId);
  if (!list) return;
  list.items.push({ id: `item_${Date.now()}`, text, done: false, addedAt: new Date().toISOString() });
  save(all);
}

export function toggleListItem(listId: string, itemId: string) {
  const all = loadLists();
  const list = all.find((l) => l.id === listId);
  if (!list) return;
  const item = list.items.find((i) => i.id === itemId);
  if (item) { item.done = !item.done; save(all); }
}

export function removeListItem(listId: string, itemId: string) {
  const all = loadLists();
  const list = all.find((l) => l.id === listId);
  if (!list) return;
  list.items = list.items.filter((i) => i.id !== itemId);
  save(all);
}

export function clearDoneItems(listId: string) {
  const all = loadLists();
  const list = all.find((l) => l.id === listId);
  if (!list) return;
  list.items = list.items.filter((i) => !i.done);
  save(all);
}

export function newList(): HenryList {
  return { id: `list_${Date.now()}`, name: '', icon: '📝', items: [], createdAt: new Date().toISOString() };
}
