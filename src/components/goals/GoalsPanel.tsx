/**
 * Henry Goals & Commitments Panel
 * Track goals with priority/significance scores
 * Commitments extracted from conversations
 * Milestones linked to projects
 */
import { useState, useEffect } from 'react';
import { sendToHenry } from '../../actions/store/chatBridgeStore';
import { useStore } from '../../store';

interface Goal {
  id: string; title: string; summary?: string; status: string;
  priority_score: number; strategic_significance_score: number;
  emotional_significance_score: number;
  created_at: string; updated_at: string;
}

interface Commitment {
  id: string; description: string; status: string;
  due_date?: string; importance_score: number;
  source_conversation_id?: string; created_at: string;
}

const api = (window as any).henryAPI;

type Tab = 'goals' | 'commitments';

const STATUS_COLORS: Record<string, string> = {
  active:      'text-green-400 border-green-400/30 bg-green-400/5',
  completed:   'text-henry-text-muted border-henry-border/30 bg-henry-surface/30',
  paused:      'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
  abandoned:   'text-red-400/60 border-red-400/20',
  open:        'text-blue-400 border-blue-400/30 bg-blue-400/5',
  in_progress: 'text-henry-accent border-henry-accent/30 bg-henry-accent/5',
};

function ScoreBar({ value, color = 'bg-henry-accent' }: { value: number; color?: string }) {
  return (
    <div className="flex-1 bg-henry-surface rounded-full h-1">
      <div className={`${color} h-1 rounded-full transition-all`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export default function GoalsPanel() {
  const { setCurrentView } = useStore();
  const [tab, setTab]             = useState<Tab>('goals');
  const [goals, setGoals]         = useState<Goal[]>([]);
  const [allGoals, setAllGoals]   = useState<Goal[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [selected, setSelected]   = useState<Goal | null>(null);
  const [showAll, setShowAll]     = useState(false);
  const [adding, setAdding]       = useState(false);
  const [newGoal, setNewGoal]     = useState({ title: '', summary: '', priority: '0.7' });
  const [newCommit, setNewCommit] = useState({ description: '', dueDate: '' });
  const [addingCommit, setAddingCommit] = useState(false);
  const [saving, setSaving]       = useState(false);

  async function loadGoals() {
    const active = await api.getGoals({ status: 'active', limit: 30 }) as Goal[] || [];
    const all = await api.getGoals({ status: 'all', limit: 50 }) as Goal[] || [];
    setGoals(active);
    setAllGoals(all);
  }

  async function loadCommitments() {
    const data = await api.getCommitments({ limit: 40 }) as Commitment[] || [];
    setCommitments(data);
  }

  useEffect(() => {
    void loadGoals();
    void loadCommitments();
  }, []);

  async function handleAddGoal(e: React.FormEvent) {
    e.preventDefault();
    if (!newGoal.title.trim()) return;
    setSaving(true);
    await api.saveGoal({
      title: newGoal.title.trim(),
      summary: newGoal.summary.trim() || undefined,
      priorityScore: parseFloat(newGoal.priority) || 0.7,
      strategicSignificanceScore: parseFloat(newGoal.priority) || 0.7,
      emotionalSignificanceScore: 0.5,
    });
    setNewGoal({ title: '', summary: '', priority: '0.7' });
    setAdding(false);
    setSaving(false);
    await loadGoals();
  }

  async function handleAddCommitment(e: React.FormEvent) {
    e.preventDefault();
    if (!newCommit.description.trim()) return;
    setSaving(true);
    await api.saveCommitment({
      description: newCommit.description.trim(),
      dueDate: newCommit.dueDate || undefined,
      importanceScore: 0.7,
    });
    setNewCommit({ description: '', dueDate: '' });
    setAddingCommit(false);
    setSaving(false);
    await loadCommitments();
  }

  async function setGoalStatus(id: string, status: string) {
    await api.updateGoal(id, { status });
    await loadGoals();
    setSelected(null);
  }

  async function resolveCommitment(id: string) {
    await api.resolveCommitment(id);
    await loadCommitments();
  }

  function askHenryAboutGoal(g: Goal) {
    sendToHenry(`Help me think through my goal: "${g.title}"${g.summary ? '\n' + g.summary : ''}. What's the most important next step? What might be blocking me?`);
    setCurrentView('chat');
  }

  function askHenryAboutCommitments() {
    const open = commitments.filter(c => c.status !== 'completed').slice(0, 5).map(c => `• ${c.description}`).join('\n');
    sendToHenry(`My open commitments:\n${open}\n\nHelp me prioritize these and identify which ones I should tackle first.`);
    setCurrentView('chat');
  }

  const displayGoals = showAll ? allGoals : goals;
  const inp = "w-full bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-all";

  return (
    <div className="flex flex-col h-full bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-henry-border/20 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-henry-text">Goals</h1>
          <button onClick={() => { setAdding(a => !a); setAddingCommit(false); setSelected(null); }}
            className="text-[11px] px-4 py-1.5 rounded-xl bg-henry-accent text-white font-semibold hover:bg-henry-accent/80 transition-all">
            + Goal
          </button>
        </div>
        <div className="flex gap-1">
          {(['goals', 'commitments'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={'text-[12px] px-3 py-1.5 rounded-lg font-medium transition-all capitalize ' +
                (tab === t ? 'bg-henry-accent text-white' : 'bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text')}>
              {t}{t === 'commitments' && commitments.filter(c => c.status !== 'completed').length > 0
                ? ` (${commitments.filter(c => c.status !== 'completed').length})` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

        {/* ── GOALS TAB ── */}
        {tab === 'goals' && (
          <>
            {/* Add goal form */}
            {adding && (
              <form onSubmit={handleAddGoal} className="bg-henry-surface rounded-xl border border-henry-border/20 p-4 space-y-3">
                <p className="text-[10px] uppercase tracking-wider text-henry-text-muted">New Goal</p>
                <input value={newGoal.title} onChange={e => setNewGoal(g => ({ ...g, title: e.target.value }))}
                  placeholder="What do you want to achieve?" className={inp} autoFocus />
                <textarea value={newGoal.summary} onChange={e => setNewGoal(g => ({ ...g, summary: e.target.value }))}
                  placeholder="Why does this matter? (optional)" rows={2} className={inp + ' resize-none'} />
                <div className="flex items-center gap-3">
                  <label className="text-[10px] text-henry-text-muted flex-shrink-0">Priority</label>
                  <input type="range" min="0.1" max="1" step="0.1" value={newGoal.priority}
                    onChange={e => setNewGoal(g => ({ ...g, priority: e.target.value }))}
                    className="flex-1 accent-henry-accent" />
                  <span className="text-[11px] text-henry-text-muted w-8">{Math.round(parseFloat(newGoal.priority) * 10)}/10</span>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={saving || !newGoal.title.trim()}
                    className="px-4 py-2 rounded-xl bg-henry-accent text-white text-sm font-semibold disabled:opacity-40 hover:bg-henry-accent/80 transition-all">
                    {saving ? 'Saving…' : 'Add Goal'}
                  </button>
                  <button type="button" onClick={() => setAdding(false)} className="px-4 py-2 rounded-xl bg-henry-surface2 border border-henry-border/30 text-henry-text-muted text-sm">Cancel</button>
                </div>
              </form>
            )}

            {/* Goal detail */}
            {selected && !adding && (
              <div className="bg-henry-surface rounded-xl border border-henry-accent/20 p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-henry-text text-base">{selected.title}</p>
                    {selected.summary && <p className="text-sm text-henry-text-muted mt-1 leading-relaxed">{selected.summary}</p>}
                  </div>
                  <button onClick={() => setSelected(null)} className="text-henry-text-muted hover:text-henry-text text-sm flex-shrink-0">✕</button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-henry-text-muted w-20 flex-shrink-0">Priority</span>
                    <ScoreBar value={selected.priority_score} color="bg-henry-accent" />
                    <span className="text-henry-text-muted">{Math.round(selected.priority_score * 10)}/10</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-henry-text-muted w-20 flex-shrink-0">Strategic</span>
                    <ScoreBar value={selected.strategic_significance_score} color="bg-blue-400" />
                    <span className="text-henry-text-muted">{Math.round(selected.strategic_significance_score * 10)}/10</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-henry-text-muted w-20 flex-shrink-0">Emotional</span>
                    <ScoreBar value={selected.emotional_significance_score} color="bg-rose-400" />
                    <span className="text-henry-text-muted">{Math.round(selected.emotional_significance_score * 10)}/10</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={() => askHenryAboutGoal(selected)}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-accent/10 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/20 transition-all">
                    Think through with Henry
                  </button>
                  {['active','paused','completed','abandoned'].filter(s => s !== selected.status).map(s => (
                    <button key={s} onClick={() => void setGoalStatus(selected.id, s)}
                      className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all capitalize">
                      Mark {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Goals list */}
            {displayGoals.length === 0 && !adding && (
              <div className="text-center py-12 space-y-3">
                <p className="text-3xl">◎</p>
                <p className="text-henry-text-muted text-sm">No active goals.</p>
                <button onClick={() => setAdding(true)}
                  className="text-[12px] px-4 py-2 rounded-xl bg-henry-accent text-white font-semibold">
                  Add your first goal
                </button>
              </div>
            )}

            {displayGoals.map(g => (
              <button key={g.id} onClick={() => setSelected(s => s?.id === g.id ? null : g)}
                className={`w-full text-left rounded-xl border p-4 transition-all space-y-2 ${
                  selected?.id === g.id ? 'border-henry-accent/40 bg-henry-accent/5' : 'border-henry-border/20 bg-henry-surface hover:border-henry-accent/20'
                }`}>
                <div className="flex items-start gap-2">
                  <div className={`text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0 mt-0.5 capitalize ${STATUS_COLORS[g.status] || STATUS_COLORS.active}`}>
                    {g.status}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-henry-text">{g.title}</p>
                    {g.summary && <p className="text-[11px] text-henry-text-muted mt-0.5 truncate">{g.summary}</p>}
                  </div>
                  <span className="text-[10px] text-henry-text-muted flex-shrink-0">{Math.round(g.priority_score * 10)}/10</span>
                </div>
                <div className="flex items-center gap-2">
                  <ScoreBar value={g.priority_score} />
                </div>
              </button>
            ))}

            {!showAll && allGoals.length > goals.length && (
              <button onClick={() => setShowAll(true)} className="w-full text-center text-[11px] text-henry-text-muted hover:text-henry-text transition-all py-2">
                Show {allGoals.length - goals.length} completed/paused goals
              </button>
            )}
          </>
        )}

        {/* ── COMMITMENTS TAB ── */}
        {tab === 'commitments' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-henry-text-muted">Things you've committed to — extracted from conversations or added manually.</p>
              <div className="flex gap-2">
                {commitments.some(c => c.status !== 'completed') && (
                  <button onClick={askHenryAboutCommitments}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-accent transition-all">
                    Ask Henry
                  </button>
                )}
                <button onClick={() => setAddingCommit(a => !a)}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-accent text-white font-semibold hover:bg-henry-accent/80 transition-all">
                  + Add
                </button>
              </div>
            </div>

            {addingCommit && (
              <form onSubmit={handleAddCommitment} className="bg-henry-surface rounded-xl border border-henry-border/20 p-4 space-y-3">
                <input value={newCommit.description} onChange={e => setNewCommit(c => ({ ...c, description: e.target.value }))}
                  placeholder="What did you commit to?" className={inp} autoFocus />
                <input type="date" value={newCommit.dueDate} onChange={e => setNewCommit(c => ({ ...c, dueDate: e.target.value }))}
                  className={inp} />
                <div className="flex gap-2">
                  <button type="submit" disabled={saving || !newCommit.description.trim()}
                    className="px-4 py-2 rounded-xl bg-henry-accent text-white text-sm font-semibold disabled:opacity-40">
                    Add
                  </button>
                  <button type="button" onClick={() => setAddingCommit(false)} className="px-4 py-2 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm">Cancel</button>
                </div>
              </form>
            )}

            {commitments.length === 0 && (
              <div className="text-center py-12 space-y-2">
                <p className="text-3xl">◇</p>
                <p className="text-henry-text-muted text-sm">No open commitments.</p>
                <p className="text-henry-text-muted text-xs">Henry extracts commitments from your conversations automatically.</p>
              </div>
            )}

            {commitments.filter(c => c.status !== 'completed').map(c => (
              <div key={c.id} className="group flex items-start gap-3 p-3 rounded-xl hover:bg-henry-surface/40 transition-all border border-henry-border/10">
                <button onClick={() => void resolveCommitment(c.id)}
                  className="w-5 h-5 rounded-full border-2 border-henry-border/40 hover:border-green-400 hover:bg-green-400/10 flex-shrink-0 mt-0.5 transition-all" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-henry-text leading-snug">{c.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize ${STATUS_COLORS[c.status] || STATUS_COLORS.open}`}>
                      {c.status.replace('_', ' ')}
                    </span>
                    {c.due_date && (
                      <span className={`text-[10px] ${new Date(c.due_date) < new Date() ? 'text-red-400' : 'text-henry-text-muted'}`}>
                        Due {new Date(c.due_date).toLocaleDateString()}
                      </span>
                    )}
                    <span className="text-[10px] text-henry-text-muted/50">
                      {Math.round(c.importance_score * 10)}/10 importance
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {commitments.some(c => c.status === 'completed') && (
              <div className="pt-2">
                <p className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-2">Completed</p>
                {commitments.filter(c => c.status === 'completed').slice(0, 10).map(c => (
                  <div key={c.id} className="flex items-start gap-3 p-3 opacity-40">
                    <div className="w-5 h-5 rounded-full bg-green-400/20 border-2 border-green-400/40 flex items-center justify-center text-[10px] text-green-400 flex-shrink-0 mt-0.5">✓</div>
                    <p className="text-sm text-henry-text-muted line-through">{c.description}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
