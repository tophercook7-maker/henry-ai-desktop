/**
 * MoneyEnginePanel — the MixedMakerShop lead pipeline (build plan, Phase 3).
 *
 * Leads flow new → audited → contacted → follow-up → proposal → won/lost.
 * Add a lead, move it through the stages, and watch the pipeline value. The
 * Money Crew writes to the same table, so leads it finds show up here.
 *
 * Reads via `listLeads`, writes via `createLead` / `updateLead` / `deleteLead`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

type Lead = HenryLead;

const STAGES: { id: Lead['status']; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'audited', label: 'Audited' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'follow_up', label: 'Follow-up' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

const STAGE_DOT: Record<Lead['status'], string> = {
  new: 'bg-henry-text-muted',
  audited: 'bg-sky-400',
  contacted: 'bg-indigo-400',
  follow_up: 'bg-amber-400',
  proposal: 'bg-violet-400',
  won: 'bg-emerald-400',
  lost: 'bg-red-400',
};

function api() {
  return typeof window !== 'undefined' ? window.henryAPI : undefined;
}

function money(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function MoneyEnginePanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBusiness, setNewBusiness] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api()?.listLeads?.();
      if (!res) { setError('The Money Engine is only available in the desktop app.'); setLeads([]); return; }
      if (!res.ok) { setError(res.error || 'Could not load leads.'); setLeads([]); return; }
      setLeads(res.result ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load leads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addLead = useCallback(async () => {
    const business = newBusiness.trim();
    if (!business || adding) return;
    setAdding(true);
    try {
      const res = await api()?.createLead?.({ business });
      if (res?.ok && res.result) {
        setLeads((prev) => [res.result as Lead, ...prev]);
        setNewBusiness('');
      } else if (res && !res.ok) {
        setError(res.error || 'Could not add the lead.');
      }
    } finally {
      setAdding(false);
    }
  }, [newBusiness, adding]);

  const patch = useCallback(async (id: string, fields: Partial<Lead>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...fields } : l)));
    try {
      const res = await api()?.updateLead?.(id, fields);
      if (res?.ok && res.result) {
        setLeads((prev) => prev.map((l) => (l.id === id ? (res.result as Lead) : l)));
      }
    } catch {
      void load();
    }
  }, [load]);

  const remove = useCallback(async (id: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    try { await api()?.deleteLead?.(id); } catch { void load(); }
  }, [load]);

  const summary = useMemo(() => {
    const pipeline = leads.filter((l) => l.status === 'proposal').reduce((s, l) => s + (l.proposal_amount || 0), 0);
    const won = leads.filter((l) => l.status === 'won').reduce((s, l) => s + (l.proposal_amount || 0), 0);
    const active = leads.filter((l) => l.status !== 'won' && l.status !== 'lost').length;
    return { pipeline, won, active };
  }, [leads]);

  return (
    <div className="h-full overflow-y-auto bg-henry-bg">
      <div className="max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between mb-1">
          <h1 className="text-xl font-semibold text-henry-text">Money</h1>
          <button onClick={() => void load()} className="text-xs text-henry-text-muted hover:text-henry-text transition-colors">Refresh</button>
        </div>
        <p className="text-xs text-henry-text-muted mb-4">
          MixedMakerShop's lead pipeline. Henry and the Money Crew add leads here too.
        </p>

        {/* Revenue summary */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <Stat label="Active leads" value={String(summary.active)} />
          <Stat label="In proposals" value={money(summary.pipeline)} />
          <Stat label="Won" value={money(summary.won)} accent />
        </div>

        {/* Add lead */}
        <div className="flex gap-2 mb-5">
          <input
            value={newBusiness}
            onChange={(e) => setNewBusiness(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addLead(); }}
            placeholder="Add a lead — business name…"
            className="flex-1 bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50"
          />
          <button
            onClick={() => void addLead()}
            disabled={adding || !newBusiness.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-henry-accent/20 text-henry-accent hover:bg-henry-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>

        {loading && <div className="text-sm text-henry-text-muted py-12 text-center">Loading pipeline…</div>}
        {!loading && error && (
          <div className="bg-henry-surface/50 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
            {error}
            <button onClick={() => void load()} className="block mt-2 text-henry-accent hover:underline">Try again</button>
          </div>
        )}
        {!loading && !error && leads.length === 0 && (
          <div className="text-sm text-henry-text-muted py-12 text-center">
            No leads yet. Add one above, or run the <span className="text-henry-accent">Money Crew</span> to find some.
          </div>
        )}

        {!loading && !error && leads.length > 0 && (
          <div className="space-y-5">
            {STAGES.map((stage) => {
              const inStage = leads.filter((l) => l.status === stage.id);
              if (inStage.length === 0) return null;
              return (
                <div key={stage.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full ${STAGE_DOT[stage.id]}`} />
                    <h2 className="text-xs font-semibold text-henry-text-dim uppercase tracking-wide">{stage.label}</h2>
                    <span className="text-[10px] text-henry-text-muted">{inStage.length}</span>
                  </div>
                  <div className="space-y-2">
                    {inStage.map((l) => (
                      <LeadCard key={l.id} lead={l} onPatch={patch} onRemove={remove} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-henry-surface/40 border border-henry-border/30 rounded-xl p-3">
      <div className={`text-lg font-semibold ${accent ? 'text-emerald-400' : 'text-henry-text'}`}>{value}</div>
      <div className="text-[10px] text-henry-text-muted mt-0.5">{label}</div>
    </div>
  );
}

function LeadCard({
  lead,
  onPatch,
  onRemove,
}: {
  lead: Lead;
  onPatch: (id: string, fields: Partial<Lead>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="bg-henry-surface/40 border border-henry-border/30 rounded-xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-henry-text truncate">{lead.business}</div>
          <div className="text-[11px] text-henry-text-muted mt-0.5 flex flex-wrap gap-x-2">
            {lead.contact_name && <span>{lead.contact_name}</span>}
            {lead.website && <span className="truncate">{lead.website}</span>}
            {lead.source && <span>via {lead.source}</span>}
            {lead.proposal_amount != null && <span className="text-henry-text">{money(lead.proposal_amount)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <select
            value={lead.status}
            onChange={(e) => onPatch(lead.id, { status: e.target.value as Lead['status'] })}
            className="text-[11px] rounded-full px-2 py-1 bg-henry-surface text-henry-text-muted border border-henry-border/30 outline-none cursor-pointer"
          >
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button
            onClick={() => onRemove(lead.id)}
            title="Remove lead"
            className="text-henry-text-muted hover:text-red-400 transition-colors text-xs px-1"
          >
            ✕
          </button>
        </div>
      </div>
      {(lead.audit_notes || lead.notes) && (
        <p className="text-[11px] text-henry-text-muted mt-2 whitespace-pre-wrap leading-relaxed">
          {lead.audit_notes || lead.notes}
        </p>
      )}
    </div>
  );
}
