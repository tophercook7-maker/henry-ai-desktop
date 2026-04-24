import { useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { PANEL_QUICK_ASK } from '../../henry/henryQuickAsk';
import {
  loadLists, saveList, deleteList, addItemToList, toggleListItem, removeListItem, clearDoneItems, newList,
  type HenryList,
} from '../../henry/listsData';

const LIST_ICONS = ['🛒', '🔩', '🏠', '💡', '📝', '🧹', '🍕', '🎯', '📦', '🌱', '🔧', '❤️'];

export default function ListsPanel() {
  const [lists, setLists] = useState<HenryList[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addItem, setAddItem] = useState('');
  const [editingList, setEditingList] = useState<HenryList | null>(null);
  const [showIcons, setShowIcons] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const { setCurrentView } = useStore();

  function askHenryAboutList() {
    if (!selected) return;
    const items = selected.items.filter(i => !i.done).map(i => i.text).join(', ');
    const prompt = `I have a list called "${selected.name}" with these items: ${items}. Help me think through this list — what should I prioritize, what am I missing, and is there anything I should add or remove?`;
    window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode: 'companion', prompt } }));
    setCurrentView('chat');
  }

  const reload = useCallback(() => {
    const all = loadLists();
    setLists(all);
    if (!selectedId && all.length > 0) setSelectedId(all[0].id);
  }, [selectedId]);

  useEffect(() => { reload(); }, [reload]);

  const selected = lists.find((l) => l.id === selectedId) || null;

  function handleAddItem() {
    if (!addItem.trim() || !selectedId) return;
    addItemToList(selectedId, addItem.trim());
    setAddItem('');
    reload();
    setTimeout(() => addRef.current?.focus(), 50);
  }

  function handleToggle(itemId: string) {
    if (!selectedId) return;
    toggleListItem(selectedId, itemId);
    reload();
  }

  function handleRemoveItem(itemId: string) {
    if (!selectedId) return;
    removeListItem(selectedId, itemId);
    reload();
  }

  function handleClearDone() {
    if (!selectedId) return;
    clearDoneItems(selectedId);
    reload();
  }

  function handleSaveList() {
    if (!editingList || !editingList.name.trim()) return;
    saveList(editingList);
    setSelectedId(editingList.id);
    setEditingList(null);
    setShowIcons(false);
    reload();
  }

  function handleDeleteList() {
    if (!editingList) return;
    deleteList(editingList.id);
    setEditingList(null);
    setSelectedId(lists.find((l) => l.id !== editingList.id)?.id || null);
    reload();
  }

  function copyList() {
    if (!selected) return;
    const text = `${selected.icon} ${selected.name}\n\n` + selected.items.filter((i) => !i.done).map((i) => `• ${i.text}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const pendingCount = selected?.items.filter((i) => !i.done).length ?? 0;
  const doneCount = selected?.items.filter((i) => i.done).length ?? 0;

  return (
    <div className="flex h-full bg-henry-bg">
      {/* Lists sidebar */}
      <div className="w-48 shrink-0 border-r border-henry-border/30 flex flex-col bg-henry-surface/30">
        <div className="p-3 border-b border-henry-border/30">
          <button
            onClick={() => { const l = newList(); setEditingList(l); setShowIcons(false); }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-henry-accent/10 text-henry-accent rounded-lg text-xs font-medium hover:bg-henry-accent/20 transition-colors"
          >+ New List</button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {lists.map((l) => (
            <button key={l.id} onClick={() => { setSelectedId(l.id); setEditingList(null); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${selectedId === l.id ? 'bg-henry-accent/10 text-henry-accent' : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-surface/50'}`}>
              <span className="text-sm">{l.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{l.name}</p>
                <p className="text-[10px] text-henry-text-dim">{l.items.filter((i) => !i.done).length} items</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* List content */}
      <div className="flex-1 flex flex-col min-h-0">
        {selected ? (
          <>
            {/* Header */}
            <div className="p-6 border-b border-henry-border/30">
              <div className="flex items-center justify-between">
              <button
                onClick={() => PANEL_QUICK_ASK.lists()}
                className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-accent/10 text-henry-accent hover:bg-henry-accent/20 transition-all"
              >🧠 Ask Henry</button>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{selected.icon}</span>
                  <div>
                    <h1 className="text-xl font-semibold text-henry-text">{selected.name}</h1>
                    <p className="text-xs text-henry-text-muted">{pendingCount} remaining{doneCount > 0 ? ` · ${doneCount} done` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {doneCount > 0 && (
                    <button onClick={handleClearDone} className="text-xs text-henry-text-muted hover:text-henry-text transition-colors">Clear done</button>
                  )}
                  <button onClick={copyList} className="px-3 py-1.5 text-xs text-henry-text-muted border border-henry-border/40 rounded-lg hover:text-henry-text transition-colors">Copy</button>
                  <button onClick={() => setEditingList({ ...selected })} className="px-3 py-1.5 text-xs text-henry-text-muted border border-henry-border/40 rounded-lg hover:text-henry-text transition-colors">Edit</button>
                </div>
              </div>

              {/* Quick add */}
              <div className="flex gap-2 mt-4">
                <input
                  ref={addRef}
                  value={addItem}
                  onChange={(e) => setAddItem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem(); }}
                  placeholder={`Add to ${selected.name}...`}
                  className="flex-1 bg-henry-surface/50 border border-henry-border/40 rounded-xl px-4 py-2.5 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50"
                />
                <button onClick={handleAddItem} disabled={!addItem.trim()} className="px-4 py-2.5 bg-henry-accent text-henry-bg rounded-xl text-sm font-semibold hover:bg-henry-accent/90 disabled:opacity-40 transition-colors">Add</button>
              </div>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-4">
              {selected.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-henry-text-dim">
                  <span className="text-2xl mb-2">{selected.icon}</span>
                  <p className="text-sm">This list is empty</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selected.items.filter((i) => !i.done).map((item) => (
                    <div key={item.id} className="group flex items-center gap-3 p-3 rounded-xl hover:bg-henry-surface/30 transition-colors">
                      <button onClick={() => handleToggle(item.id)}
                        className="w-5 h-5 rounded-full border-2 border-henry-border hover:border-henry-accent flex items-center justify-center shrink-0 transition-colors" />
                      <span className="flex-1 text-sm text-henry-text">{item.text}</span>
                      <button onClick={() => handleRemoveItem(item.id)} className="opacity-0 group-hover:opacity-100 p-1 text-henry-text-dim hover:text-henry-error transition-all text-xs">✕</button>
                    </div>
                  ))}
                  {selected.items.some((i) => i.done) && (
                    <>
                      <div className="flex items-center gap-2 mt-4 mb-2">
                        <span className="text-[10px] text-henry-text-dim uppercase tracking-wider">Done</span>
                        <div className="flex-1 h-px bg-henry-border/20" />
                      </div>
                      {selected.items.filter((i) => i.done).map((item) => (
                        <div key={item.id} className="group flex items-center gap-3 p-3 rounded-xl hover:bg-henry-surface/30 transition-colors opacity-50">
                          <button onClick={() => handleToggle(item.id)}
                            className="w-5 h-5 rounded-full border-2 border-henry-accent bg-henry-accent flex items-center justify-center shrink-0">
                            <span className="text-henry-bg text-[10px] font-bold">✓</span>
                          </button>
                          <span className="flex-1 text-sm text-henry-text-dim line-through">{item.text}</span>
                          <button onClick={() => handleRemoveItem(item.id)} className="opacity-0 group-hover:opacity-100 p-1 text-henry-text-dim hover:text-henry-error transition-all text-xs">✕</button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-henry-text-dim">
            <span className="text-4xl mb-3">📝</span>
            <p className="text-sm">Select a list or create a new one</p>
          </div>
        )}
      </div>

      {/* Edit list panel */}
      {editingList && (
        <div className="absolute inset-0 bg-henry-bg/80 backdrop-blur-sm flex items-center justify-center z-20" onClick={() => setEditingList(null)}>
          <div className="bg-henry-surface border border-henry-border/50 rounded-2xl w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-henry-border/30 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-henry-text">{lists.some((l) => l.id === editingList.id) ? 'Edit' : 'New'} List</h2>
              <button onClick={() => setEditingList(null)} className="text-henry-text-dim hover:text-henry-text text-lg leading-none">×</button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs text-henry-text-muted mb-1">Icon</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowIcons(!showIcons)} className="w-10 h-10 rounded-lg bg-henry-bg border border-henry-border/50 flex items-center justify-center text-xl hover:border-henry-accent/50 transition-colors">
                    {editingList.icon}
                  </button>
                  {showIcons && (
                    <div className="flex flex-wrap gap-1">
                      {LIST_ICONS.map((icon) => (
                        <button key={icon} onClick={() => { setEditingList({ ...editingList, icon }); setShowIcons(false); }}
                          className="w-8 h-8 rounded-lg hover:bg-henry-surface flex items-center justify-center text-base transition-colors">{icon}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs text-henry-text-muted mb-1">List name *</label>
                <input autoFocus value={editingList.name} onChange={(e) => setEditingList({ ...editingList, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveList(); }}
                  placeholder="e.g. Grocery, Hardware..."
                  className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50" />
              </div>
            </div>
            <div className="p-4 border-t border-henry-border/30 flex gap-2">
              <button onClick={handleSaveList} disabled={!editingList.name.trim()} className="flex-1 py-2.5 bg-henry-accent text-henry-bg rounded-xl text-sm font-semibold hover:bg-henry-accent/90 disabled:opacity-40">Save</button>
              {lists.some((l) => l.id === editingList.id) && (
                <button onClick={handleDeleteList} className="px-3 py-2.5 text-henry-error hover:bg-henry-error/10 rounded-xl text-sm">Delete</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
