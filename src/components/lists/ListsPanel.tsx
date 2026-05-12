import { useState, useEffect, useRef } from 'react';
import { sendToHenry } from '../../actions/store/chatBridgeStore';
import { useStore } from '../../store';

interface ListItem { id:string; list_id:string; text:string; done:number; position:number; created_at:string }
interface HenryList { id:string; name:string; icon:string; color?:string; created_at:string; updated_at:string; items:ListItem[] }

const getApi = () => (window as any).henryAPI as any;
const ICONS = ['📝','🛒','🔩','🏠','💡','🧹','🍕','🎯','📦','🌱','🔧','❤️','💼','🏋️','🎵','📚'];

export default function ListsPanel() {
  const { setCurrentView } = useStore();
  const [lists, setLists]     = useState<HenryList[]>([]);
  const [selId, setSelId]     = useState<string|null>(null);
  const [newName, setNewName] = useState('');
  const [newItem, setNewItem] = useState('');
  const [pickIcon, setPickIcon] = useState(false);
  const [editName, setEditName] = useState(false);
  const [editVal, setEditVal] = useState('');
  const itemRef = useRef<HTMLInputElement>(null);
  const [suggesting, setSuggesting] = useState(false);

  const selected = lists.find(l => l.id === selId) || null;

  async function load() {
    const data = await getApi()?.listsAll() as HenryList[];
    setLists(data);
    if (data.length && !selId) setSelId(data[0].id);
  }

  useEffect(() => { void load(); }, []);

  async function createList(name: string, icon='📝') {
    if (!name.trim()) return;
    const id = crypto.randomUUID();
    await getApi()?.listsSave({ id, name: name.trim(), icon });
    await load();
    setSelId(id);
    setNewName('');
  }

  async function addItem() {
    if (!newItem.trim() || !selId) return;
    await getApi()?.listsAddItem(selId, { id: crypto.randomUUID(), text: newItem.trim() });
    setNewItem('');
    await load();
    itemRef.current?.focus();
  }

  async function toggleItem(itemId: string) {
    await getApi()?.listsToggleItem(itemId);
    await load();
  }

  async function deleteItem(itemId: string) {
    await getApi()?.listsDeleteItem(itemId);
    await load();
  }

  async function clearDone() {
    if (!selId) return;
    await getApi()?.listsClearDone(selId);
    await load();
  }

  async function deleteList(id: string) {
    await getApi()?.listsDelete(id);
    const remaining = lists.filter(l => l.id !== id);
    setLists(remaining);
    setSelId(remaining[0]?.id || null);
  }

  async function updateIcon(icon: string) {
    if (!selected) return;
    await getApi()?.listsSave({ id: selected.id, name: selected.name, icon });
    setPickIcon(false);
    await load();
  }

  async function saveEditName() {
    if (!selected || !editVal.trim()) return;
    await getApi()?.listsSave({ id: selected.id, name: editVal.trim(), icon: selected.icon });
    setEditName(false);
    await load();
  }

  async function suggestItems() {
    if (!selected || suggesting) return;
    setSuggesting(true);
    const existing = selected.items.map(i => i.text).join(', ');
    const deviceId = (() => { let id = localStorage.getItem('henry:device_id'); if (!id) { id = crypto.randomUUID(); localStorage.setItem('henry:device_id', id); } return id; })();
    try {
      const r = await fetch('https://henry-proxy.henryai.workers.dev/v1/chat', {
        signal: AbortSignal.timeout(25000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Henry-Device': deviceId },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'For a list called "' + selected.name + '" that already has: ' + (existing || 'nothing yet') + ' — suggest 5 more useful items. Reply with ONLY the items, one per line, no numbers or bullets.' }], max_tokens: 150, stream: false }),
      });
      const d = await r.json() as any;
      const suggestions = (d?.choices?.[0]?.message?.content || '').split('\n').map((s: string) => s.trim()).filter(Boolean).slice(0, 5);
      for (const sug of suggestions) {
        await getApi()?.listsAddItem(selected.id, { id: crypto.randomUUID(), text: sug });
      }
      await load();
    } catch { /* ignore */ }
    setSuggesting(false);
  }

  async function askHenry() {
    if (!selected) return;
    const undone = selected.items.filter(i => !i.done).map(i => i.text).join(', ');
    sendToHenry(`I have a list called "${selected.name}" with these items: ${undone}. Help me think through it — what should I prioritize, what might I be missing?`);
    setCurrentView('chat');
  }

  const doneCount = selected?.items.filter(i => i.done).length || 0;
  const totalCount = selected?.items.length || 0;

  return (
    <div className="flex h-full bg-henry-bg overflow-hidden">
      {/* Sidebar */}
      <div className="w-60 flex-shrink-0 border-r border-henry-border/20 flex flex-col">
        <div className="p-3 border-b border-henry-border/20">
          <form onSubmit={e => { e.preventDefault(); void createList(newName); }} className="flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New list…"
              className="flex-1 bg-henry-surface border border-henry-border/30 rounded-lg px-2 py-1.5 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 min-w-0" />
            <button type="submit" disabled={!newName.trim()} className="text-henry-accent text-lg disabled:opacity-30 flex-shrink-0">+</button>
          </form>
        </div>
        <div className="flex-1 overflow-y-auto">
          {lists.length === 0 && <p className="p-4 text-henry-text-muted text-xs text-center">No lists yet. Create one above.</p>}
          {lists.map(l => {
            const done = l.items.filter(i => i.done).length;
            const total = l.items.length;
            return (
              <button key={l.id} onClick={() => setSelId(l.id)}
                className={'w-full text-left px-3 py-2.5 border-b border-henry-border/10 hover:bg-henry-surface/40 transition-all ' + (selId===l.id ? 'bg-henry-surface/60 border-l-2 border-l-henry-accent' : '')}>
                <div className="flex items-center gap-2">
                  <span className="text-base">{l.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-henry-text truncate">{l.name}</p>
                    {total > 0 && <p className="text-[10px] text-henry-text-muted">{done}/{total} done</p>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Header */}
            <div className="px-5 py-3 border-b border-henry-border/20 flex items-center gap-3 flex-shrink-0">
              <button onClick={() => setPickIcon(p=>!p)} className="text-2xl hover:scale-110 transition-transform">{selected.icon}</button>
              {pickIcon && (
                <div className="absolute top-16 left-64 z-20 bg-henry-surface border border-henry-border/30 rounded-xl p-3 grid grid-cols-8 gap-1.5 shadow-xl">
                  {ICONS.map(ic => <button key={ic} onClick={() => void updateIcon(ic)} className="text-xl hover:scale-110 transition-transform">{ic}</button>)}
                </div>
              )}
              {editName ? (
                <input value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => void saveEditName()}
                  onKeyDown={e => { if (e.key==='Enter') void saveEditName(); if (e.key==='Escape') setEditName(false); }}
                  autoFocus className="flex-1 bg-transparent text-lg font-bold text-henry-text outline-none border-b border-henry-accent/50" />
              ) : (
                <h2 className="flex-1 text-lg font-bold text-henry-text cursor-pointer hover:text-henry-accent transition-colors"
                  onClick={() => { setEditName(true); setEditVal(selected.name); }}>{selected.name}</h2>
              )}
              <div className="flex items-center gap-2">
                {totalCount > 0 && <span className="text-[11px] text-henry-text-muted">{doneCount}/{totalCount}</span>}
                {doneCount > 0 && <button onClick={() => void clearDone()} className="text-[10px] text-henry-text-muted hover:text-henry-text transition-all px-2 py-1 rounded border border-henry-border/30">Clear done</button>}
                <button onClick={() => void suggestItems()} disabled={suggesting} className="text-[11px] px-2 py-1 rounded border border-henry-border/30 text-henry-text-muted hover:text-henry-accent disabled:opacity-40 transition-all">
                    {suggesting ? '…' : '✨ Suggest'}
                  </button>
                  <button onClick={askHenry} className="text-[11px] px-2 py-1 rounded border border-henry-border/30 text-henry-text-muted hover:text-henry-accent transition-all">Ask Henry</button>
                <button onClick={() => void deleteList(selected.id)} className="text-[11px] text-henry-text-muted hover:text-red-400 transition-all px-1">✕</button>
              </div>
            </div>

            {/* Progress bar */}
            {totalCount > 0 && (
              <div className="h-0.5 bg-henry-surface">
                <div className="h-full bg-henry-accent transition-all duration-500" style={{width: (doneCount/totalCount*100)+'%'}} />
              </div>
            )}

            {/* Items */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
              {selected.items.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-2xl mb-2">📋</p>
                  <p className="text-henry-text-muted text-sm">Nothing on this list yet.</p>
                </div>
              )}
              {selected.items.filter(i=>!i.done).map(item => (
                <div key={item.id} className="group flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-henry-surface/30 transition-all">
                  <button onClick={() => void toggleItem(item.id)}
                    className="w-5 h-5 rounded-full border-2 border-henry-border/40 hover:border-henry-accent flex-shrink-0 transition-all hover:bg-henry-accent/10" />
                  <span className="flex-1 text-sm text-henry-text">{item.text}</span>
                  <button onClick={() => void deleteItem(item.id)} className="opacity-0 group-hover:opacity-100 text-henry-text-muted hover:text-red-400 text-xs transition-all">✕</button>
                </div>
              ))}
              {doneCount > 0 && (
                <>
                  <p className="text-[10px] uppercase tracking-wider text-henry-text-muted pt-3 pb-1">Done</p>
                  {selected.items.filter(i=>i.done).map(item => (
                    <div key={item.id} className="group flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-henry-surface/20 transition-all opacity-50">
                      <button onClick={() => void toggleItem(item.id)}
                        className="w-5 h-5 rounded-full bg-henry-accent/30 border-2 border-henry-accent/40 flex-shrink-0 flex items-center justify-center text-[10px] text-henry-accent">✓</button>
                      <span className="flex-1 text-sm text-henry-text-muted line-through">{item.text}</span>
                      <button onClick={() => void deleteItem(item.id)} className="opacity-0 group-hover:opacity-100 text-henry-text-muted hover:text-red-400 text-xs transition-all">✕</button>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Add item */}
            <div className="px-5 py-3 border-t border-henry-border/20 flex-shrink-0">
              <form onSubmit={e => { e.preventDefault(); void addItem(); }} className="flex gap-2">
                <input ref={itemRef} value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Add item…"
                  className="flex-1 bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50" />
                <button type="submit" disabled={!newItem.trim()} className="px-4 py-2 rounded-xl bg-henry-accent text-white text-sm font-semibold disabled:opacity-30 hover:bg-henry-accent/80 transition-all">Add</button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-henry-text-muted text-sm">Create a list to get started.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
