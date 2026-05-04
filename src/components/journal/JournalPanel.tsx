import { useState, useEffect, useRef } from 'react';
import { sendToHenry } from '../../actions/store/chatBridgeStore';
import { useStore } from '../../store';

interface JournalEntry { id:string; date:string; title?:string; content:string; mood?:string; tags:string[]; created_at:string; updated_at:string }

const api = (window as any).henryAPI;
const MOODS = ['😊','😐','😔','🔥','🙏','💡','😤','😴'];

function todayKey(){ return new Date().toISOString().slice(0,10); }

export default function JournalPanel(){
  const { setCurrentView } = useStore();
  const [entries, setEntries]     = useState<JournalEntry[]>([]);
  const [selected, setSelected]   = useState<JournalEntry|null>(null);
  const [content, setContent]     = useState('');
  const [title, setTitle]         = useState('');
  const [mood, setMood]           = useState('');
  const [search, setSearch]       = useState('');
  const [dirty, setDirty]         = useState(false);
  const [saving, setSaving]       = useState(false);
  const [search_q, setSearchQ]    = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  async function loadList(q?:string){
    const data = await api.journalList(q||undefined) as JournalEntry[];
    setEntries(data.map(e=>({...e, tags: JSON.parse(e.tags as any||'[]')})));
  }

  async function openEntry(e:JournalEntry){
    const full = await api.journalGet(e.id) as JournalEntry|null;
    const entry = full || e;
    setSelected({...entry, tags: JSON.parse((entry.tags as any) || '[]')});
    setContent(entry.content||'');
    setTitle(entry.title||'');
    setMood(entry.mood||'');
    setDirty(false);
  }

  async function newEntry(){
    const today = todayKey();
    const existing = entries.find(e=>e.date===today);
    if(existing){ openEntry(existing); return; }
    const entry:JournalEntry = { id:crypto.randomUUID(), date:today, content:'', tags:[], created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
    setSelected(entry); setContent(''); setTitle(''); setMood(''); setDirty(false);
    setTimeout(()=>textRef.current?.focus(), 50);
  }

  async function save(s?:JournalEntry, c?:string, ti?:string, mo?:string){
    const entry = s||selected; if(!entry) return;
    setSaving(true);
    await api.journalSave({ id:entry.id, date:entry.date, title:(ti??title)||null, content:(c??content), mood:(mo??mood)||null, tags:entry.tags });
    setSaving(false); setDirty(false);
    await loadList(search_q);
  }

  function handleChange(val:string){ setContent(val); setDirty(true); if(saveTimer.current)clearTimeout(saveTimer.current); saveTimer.current=setTimeout(()=>save(undefined,val),2000); }

  async function handleDelete(){
    if(!selected) return;
    await api.journalDelete(selected.id);
    setSelected(null); setContent(''); setTitle(''); setMood('');
    await loadList(search_q);
  }

  function askHenry(){
    if(!content.trim()) return;
    sendToHenry(`I wrote in my journal today (${selected?.date}): "${content.slice(0,600)}". What insights or reflections do you have?`);
    setCurrentView('chat');
  }

  useEffect(()=>{ void loadList(); void newEntry(); },[]);

  useEffect(()=>{
    const t = setTimeout(()=>void loadList(search_q), 300);
    return ()=>clearTimeout(t);
  },[search_q]);

  const dateLabel = (d:string) => new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});

  return(
    <div className="flex h-full bg-henry-bg overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-henry-border/20 flex flex-col">
        <div className="p-3 border-b border-henry-border/20 space-y-2">
          {/* Streak display */}
          {(() => {
            const today = todayKey();
            let streak = 0;
            for (let i = 0; i < 30; i++) {
              const d = new Date(); d.setDate(d.getDate() - i);
              const ds = d.toISOString().slice(0,10);
              if (entries.find(e => e.date === ds)) streak++;
              else if (i > 0) break;
            }
            return streak > 1 ? (
              <div className="flex items-center gap-2 px-1 py-1 mb-1">
                <span className="text-base">🔥</span>
                <span className="text-xs font-bold text-henry-accent">{streak} day streak</span>
              </div>
            ) : null;
          })()}
          <button onClick={newEntry} className="w-full py-2 rounded-xl bg-henry-accent text-white text-sm font-semibold hover:bg-henry-accent/80 transition-all">
            + New Entry
          </button>
          <input value={search_q} onChange={e=>setSearchQ(e.target.value)} placeholder="Search journal…"
            className="w-full bg-henry-surface border border-henry-border/30 rounded-lg px-3 py-1.5 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {entries.length===0 && <p className="p-4 text-henry-text-muted text-xs text-center">No entries yet.</p>}
          {entries.map(e=>(
            <button key={e.id} onClick={()=>openEntry(e)}
              className={`w-full text-left px-4 py-3 border-b border-henry-border/10 hover:bg-henry-surface/40 transition-all ${selected?.id===e.id?'bg-henry-surface/60 border-l-2 border-l-henry-accent':''}`}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-henry-text">{dateLabel(e.date)}</p>
                {e.mood && <span className="text-sm">{e.mood}</span>}
              </div>
              {e.title && <p className="text-[11px] text-henry-text-muted truncate mt-0.5">{e.title}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <div className="flex items-center gap-2 px-6 py-3 border-b border-henry-border/20 flex-shrink-0">
              <input value={title} onChange={e=>{setTitle(e.target.value);setDirty(true);}} placeholder="Title (optional)"
                className="flex-1 bg-transparent text-sm font-semibold text-henry-text placeholder:text-henry-text-muted outline-none" />
              <div className="flex gap-1">
                {MOODS.map(m=>(
                  <button key={m} onClick={()=>{setMood(m===mood?'':m);setDirty(true);}}
                    className={`text-base transition-all ${mood===m?'opacity-100 scale-110':'opacity-40 hover:opacity-80'}`}>{m}</button>
                ))}
              </div>
              <div className="flex gap-2 ml-2">
                <span className="text-[10px] text-henry-text-muted">{content.split(/\s+/).filter(Boolean).length} words</span>
              {dirty && <button onClick={()=>save()} disabled={saving} className="text-[11px] px-3 py-1 rounded-lg bg-henry-accent text-white hover:bg-henry-accent/80 disabled:opacity-40 transition-all">{saving?'Saving…':'Save'}</button>}
                <button onClick={askHenry} className="text-[11px] px-3 py-1 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-accent transition-all">Reflect</button>
                <button onClick={handleDelete} className="text-[11px] px-2 py-1 rounded-lg text-henry-text-muted hover:text-red-400 transition-all">✕</button>
              </div>
            </div>
            <div className="px-4 py-2 border-b border-henry-border/10 flex-shrink-0">
              <p className="text-[10px] text-henry-text-muted">{dateLabel(selected.date)}</p>
            </div>
            <textarea ref={textRef} value={content} onChange={e=>handleChange(e.target.value)}
              placeholder="Write anything. Henry saves automatically…"
              className="flex-1 bg-transparent text-henry-text text-sm leading-relaxed p-6 outline-none resize-none placeholder:text-henry-text-muted/40" />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-4xl mb-3">✦</p>
              <p className="text-henry-text-muted text-sm">Select an entry or start writing.</p>
              <button onClick={newEntry} className="mt-3 text-[12px] px-4 py-2 rounded-xl bg-henry-accent text-white font-semibold">Start Today</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
