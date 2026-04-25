import { useState, useCallback, useEffect } from 'react';
import {
  loadEntries, saveEntry, deleteEntry, newEntry, getMonthSummaries, getCurrentMonthEntries,
  formatCurrency, INCOME_CATEGORIES, EXPENSE_CATEGORIES,
  type FinanceEntry, type EntryType,
} from '../../henry/financeData';
import { useStore } from '../../store';
import { PANEL_QUICK_ASK } from '../../henry/henryQuickAsk';

export default function FinancePanel() {
  const { setCurrentView } = useStore();
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [summaries, setSummaries] = useState(getMonthSummaries());
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const [addType, setAddType] = useState<EntryType>('income');
  const [showAll, setShowAll] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setEntries(loadEntries());
    setSummaries(getMonthSummaries());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const monthEntries = entries.filter((e) => e.date.startsWith(selectedMonth));
  const monthIncome = monthEntries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const monthExpenses = monthEntries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const monthNet = monthIncome - monthExpenses;

  function handleSave() {
    if (!editing || !editing.amount || !editing.description.trim()) return;
    try { saveEntry(editing); setEditing(null); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to save entry'); }
  }

  function handleAddQuick(type: EntryType) {
    setAddType(type);
    setEditing(newEntry(type));
  }

  function exportCSV() {
    const header = 'Date,Type,Category,Description,Amount';
    const rows = entries.map((e) => `${e.date},${e.type},${e.category},"${e.description}",${e.amount}`);
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'henry-finance.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function askHenry() {
    const summary = `Current month (${selectedMonth}): Income ${formatCurrency(monthIncome)}, Expenses ${formatCurrency(monthExpenses)}, Net ${formatCurrency(monthNet)}. Top expense categories: ${
      Object.entries(monthEntries.filter((e) => e.type === 'expense').reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + e.amount; return acc; }, {} as Record<string, number>))
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${formatCurrency(v)}`).join(', ')
    }.`;
    const prompt = `Here's my financial snapshot for ${selectedMonth}:\n${summary}\n\nGive me an honest read on how this month looks and one or two concrete things I should do differently.`;
    window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode: 'companion', prompt } }));
    setCurrentView('chat');
  }

  const formatMonthLabel = (m: string) => new Date(m + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="flex h-full bg-henry-bg">
      {/* Main content */}
      <div className={`flex flex-col flex-1 min-h-0 ${editing ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-6 border-b border-henry-border/30">
          <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => PANEL_QUICK_ASK.finance()}
                className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-accent/10 text-henry-accent hover:bg-henry-accent/20 transition-all"
              >🧠 Ask Henry</button>
            <div>
              <h1 className="text-xl font-semibold text-henry-text">Finance</h1>
              <p className="text-xs text-henry-text-muted mt-0.5">{formatMonthLabel(selectedMonth)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={exportCSV} className="px-3 py-1.5 text-xs text-henry-text-muted border border-henry-border/40 rounded-lg hover:text-henry-text transition-colors">Export CSV</button>
              <button onClick={() => handleAddQuick('expense')} className="px-3 py-1.5 text-xs bg-henry-error/10 text-henry-error border border-henry-error/20 rounded-lg hover:bg-henry-error/20 transition-colors">− Expense</button>
              <button onClick={() => handleAddQuick('income')} className="px-4 py-2 bg-henry-accent text-henry-bg rounded-xl text-xs font-semibold hover:bg-henry-accent/90 transition-colors">+ Income</button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
              <p className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-medium">Income</p>
              <p className="text-lg font-semibold text-emerald-400 mt-1">{formatCurrency(monthIncome)}</p>
            </div>
            <div className="bg-henry-error/10 border border-henry-error/20 rounded-xl p-4">
              <p className="text-[10px] text-henry-error/70 uppercase tracking-wider font-medium">Expenses</p>
              <p className="text-lg font-semibold text-henry-error mt-1">{formatCurrency(monthExpenses)}</p>
            </div>
            <div className={`border rounded-xl p-4 ${monthNet >= 0 ? 'bg-henry-accent/10 border-henry-accent/20' : 'bg-henry-error/10 border-henry-error/20'}`}>
              <p className={`text-[10px] uppercase tracking-wider font-medium ${monthNet >= 0 ? 'text-henry-accent/70' : 'text-henry-error/70'}`}>Net</p>
              <p className={`text-lg font-semibold mt-1 ${monthNet >= 0 ? 'text-henry-accent' : 'text-henry-error'}`}>{formatCurrency(monthNet)}</p>
            </div>
          </div>
        </div>

        {/* Month selector + entries */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Month list */}
          <div className="w-40 shrink-0 border-r border-henry-border/30 overflow-y-auto py-2">
            {summaries.length === 0 && (
              <div className="p-4 text-xs text-henry-text-dim">No data yet</div>
            )}
            {summaries.map((s) => (
              <button key={s.month} onClick={() => setSelectedMonth(s.month)}
                className={`w-full text-left px-3 py-2.5 transition-colors ${selectedMonth === s.month ? 'bg-henry-accent/10 text-henry-accent' : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-surface/40'}`}>
                <p className="text-xs font-medium">{new Date(s.month + '-02').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</p>
                <p className={`text-[10px] mt-0.5 ${s.net >= 0 ? 'text-emerald-400' : 'text-henry-error'}`}>{formatCurrency(s.net)}</p>
              </button>
            ))}
          </div>

          {/* Entry list */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-henry-text-muted uppercase tracking-wider">{monthEntries.length} Entries</p>
                <button onClick={askHenry} className="text-xs text-henry-accent hover:underline">Ask Henry to analyze</button>
              </div>
              {monthEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-henry-text-dim">
                  <span className="text-2xl mb-2">💵</span>
                  <p className="text-xs">No entries for {formatMonthLabel(selectedMonth)}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {monthEntries.sort((a, b) => b.date.localeCompare(a.date)).map((e) => (
                    <div key={e.id} className="group flex items-center gap-3 p-3 bg-henry-surface/40 rounded-xl border border-henry-border/20 hover:border-henry-border/40 transition-colors">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${e.type === 'income' ? 'bg-emerald-500/15' : 'bg-henry-error/15'}`}>
                        {e.type === 'income' ? '↑' : '↓'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-henry-text">{e.description}</p>
                        <p className="text-[10px] text-henry-text-dim">{e.category} · {e.date}</p>
                      </div>
                      <p className={`text-sm font-semibold shrink-0 ${e.type === 'income' ? 'text-emerald-400' : 'text-henry-error'}`}>
                        {e.type === 'income' ? '+' : '-'}{formatCurrency(e.amount)}
                      </p>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditing({ ...e })} className="p-1 text-henry-text-dim hover:text-henry-text">✏️</button>
                        <button onClick={() => { deleteEntry(e.id); reload(); }} className="p-1 text-henry-text-dim hover:text-henry-error">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit panel */}
      {editing && (
        <div className="w-full md:w-80 border-l border-henry-border/30 bg-henry-surface/50 flex flex-col">
          <div className="p-4 border-b border-henry-border/30 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-henry-text">{entries.some((e) => e.id === editing.id) ? 'Edit' : 'New'} {editing.type === 'income' ? 'Income' : 'Expense'}</h2>
            <button onClick={() => setEditing(null)} className="text-henry-text-dim hover:text-henry-text text-lg leading-none">×</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              {(['income', 'expense'] as EntryType[]).map((t) => (
                <button key={t} onClick={() => setEditing({ ...editing, type: t, category: t === 'income' ? 'Sales' : 'Tools & Equipment' })}
                  className={`py-2 rounded-lg text-xs font-medium capitalize transition-colors border ${editing.type === t ? (t === 'income' ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-henry-error/15 border-henry-error/30 text-henry-error') : 'border-henry-border/30 text-henry-text-dim hover:text-henry-text'}`}
                >{t}</button>
              ))}
            </div>
            <div>
              <label className="block text-xs text-henry-text-muted mb-1">Amount *</label>
              <input type="number" step="0.01" value={editing.amount || ''} onChange={(e) => setEditing({ ...editing, amount: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
                className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50" />
            </div>
            <div>
              <label className="block text-xs text-henry-text-muted mb-1">Description *</label>
              <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="What was this for?"
                className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50" />
            </div>
            <div>
              <label className="block text-xs text-henry-text-muted mb-1">Category</label>
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text focus:outline-none focus:border-henry-accent/50">
                {(editing.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-henry-text-muted mb-1">Date</label>
              <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text focus:outline-none focus:border-henry-accent/50" />
            </div>
          </div>
          <div className="p-4 border-t border-henry-border/30 flex gap-2">
            <button onClick={handleSave} disabled={!editing.amount || !editing.description.trim()} className="flex-1 py-2.5 bg-henry-accent text-henry-bg rounded-xl text-sm font-semibold hover:bg-henry-accent/90 disabled:opacity-40">Save</button>
            {entries.some((e) => e.id === editing.id) && (
              <button onClick={() => { deleteEntry(editing.id); setEditing(null); reload(); }} className="px-3 py-2.5 text-henry-error hover:bg-henry-error/10 rounded-xl text-sm">Delete</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
