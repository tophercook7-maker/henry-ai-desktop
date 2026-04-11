export type EntryType = 'income' | 'expense';

export interface FinanceEntry {
  id: string;
  type: EntryType;
  amount: number;
  category: string;
  description: string;
  date: string;
  createdAt: string;
}

export const INCOME_CATEGORIES = ['Sales', 'Consulting', 'Freelance', 'Royalties', 'Investment', 'Gift', 'Other'];
export const EXPENSE_CATEGORIES = ['Tools & Equipment', 'Materials & Supplies', 'Software & Subscriptions', 'Marketing', 'Travel', 'Meals', 'Office', 'Education', 'Taxes', 'Other'];

const KEY = 'henry:finance';

function load(): FinanceEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(items: FinanceEntry[]) { localStorage.setItem(KEY, JSON.stringify(items)); }

export const loadEntries = load;

export function saveEntry(e: FinanceEntry) {
  const all = load();
  const idx = all.findIndex((x) => x.id === e.id);
  if (idx >= 0) all[idx] = e; else all.unshift(e);
  save(all);
}

export function deleteEntry(id: string) { save(load().filter((e) => e.id !== id)); }

export function newEntry(type: EntryType = 'income'): FinanceEntry {
  return {
    id: `fin_${Date.now()}`,
    type,
    amount: 0,
    category: type === 'income' ? 'Sales' : 'Tools & Equipment',
    description: '',
    date: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  };
}

export interface MonthSummary {
  month: string;
  income: number;
  expenses: number;
  net: number;
}

export function getMonthSummaries(): MonthSummary[] {
  const all = load();
  const map = new Map<string, MonthSummary>();
  for (const e of all) {
    const m = e.date.slice(0, 7);
    if (!map.has(m)) map.set(m, { month: m, income: 0, expenses: 0, net: 0 });
    const s = map.get(m)!;
    if (e.type === 'income') s.income += e.amount;
    else s.expenses += e.amount;
    s.net = s.income - s.expenses;
  }
  return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
}

export function getCurrentMonthEntries(): FinanceEntry[] {
  const prefix = new Date().toISOString().slice(0, 7);
  return load().filter((e) => e.date.startsWith(prefix));
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}
