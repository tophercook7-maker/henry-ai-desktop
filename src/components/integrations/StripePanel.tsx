import { useState, useEffect } from 'react';
import { stripeGetBalance, stripeListCharges, type StripeBalance, type StripeCharge } from '../../henry/integrations';
import { useConnectionStore, selectStatus } from '../../henry/connectionStore';
import ConnectScreen from './ConnectScreen';

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts * 1000;
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function StripePanel() {
  const status = useConnectionStore(selectStatus('stripe'));
  const { markExpired } = useConnectionStore();
  const [balance, setBalance] = useState<StripeBalance | null>(null);
  const [charges, setCharges] = useState<StripeCharge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'connected') load();
  }, [status]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [bal, ch] = await Promise.all([stripeGetBalance(), stripeListCharges(25)]);
      setBalance(bal);
      setCharges(ch);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (status !== 'connected') return <ConnectScreen serviceId="stripe" />;

  const available = balance?.available?.[0];
  const pending = balance?.pending?.[0];

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-henry-border/30">
        <div className="flex items-center gap-3">
          <div className="text-2xl">💳</div>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-henry-text">Stripe</h1>
            <p className="text-xs text-henry-text-muted">{loading ? 'Loading…' : `${charges.length} recent charges`}</p>
          </div>
          <button onClick={load} disabled={loading} className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors" title="Refresh">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="px-4 py-3 bg-henry-error/10 border border-henry-error/30 rounded-xl text-xs text-henry-error">
            {error}
            <button onClick={() => markExpired('stripe')} className="block mt-1 text-henry-accent underline">Reconnect account</button>
          </div>
        )}

        {balance && (
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-henry-surface/40 border border-henry-border/20">
              <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wide mb-1">Available</p>
              <p className="text-2xl font-bold text-henry-success tabular-nums">{available ? formatCurrency(available.amount, available.currency) : '—'}</p>
              <p className="text-[10px] text-henry-text-muted mt-0.5">{available?.currency?.toUpperCase()}</p>
            </div>
            <div className="p-4 rounded-2xl bg-henry-surface/40 border border-henry-border/20">
              <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wide mb-1">Pending</p>
              <p className="text-2xl font-bold text-henry-warning tabular-nums">{pending ? formatCurrency(pending.amount, pending.currency) : '—'}</p>
              <p className="text-[10px] text-henry-text-muted mt-0.5">{pending?.currency?.toUpperCase()}</p>
            </div>
          </div>
        )}

        {loading && <div className="flex items-center justify-center py-12"><div className="w-6 h-6 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" /></div>}

        {!loading && charges.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-2">Recent charges</p>
            <div className="space-y-2">
              {charges.map((charge) => (
                <div key={charge.id} className="flex items-center gap-3 p-3 rounded-2xl bg-henry-surface/40 border border-henry-border/20">
                  <div className={`shrink-0 w-2 h-2 rounded-full ${charge.status === 'succeeded' ? 'bg-henry-success' : charge.status === 'failed' ? 'bg-henry-error' : 'bg-henry-warning'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-henry-text font-medium tabular-nums">{formatCurrency(charge.amount, charge.currency)}</p>
                    {charge.description && <p className="text-[11px] text-henry-text-muted truncate">{charge.description}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-[11px] font-medium ${charge.status === 'succeeded' ? 'text-henry-success' : charge.status === 'failed' ? 'text-henry-error' : 'text-henry-warning'}`}>{charge.status}</p>
                    <p className="text-[10px] text-henry-text-muted">{timeAgo(charge.created)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && !error && charges.length === 0 && balance && (
          <div className="text-center py-8 text-henry-text-muted text-sm">No recent charges found.</div>
        )}
      </div>
    </div>
  );
}
