/**
 * SettingsView — Settings tab content.
 *
 * Rebuilt 2026-06-08 after the original 2,026-line file was lost in an
 * iCloud file-churn incident and only a 3-panel placeholder remained. The
 * earlier file depended on ~9 modules that no longer exist (proxyUsage,
 * priority/*, initiativeStore, sessionModeStore, richMemory, …), so rather
 * than resurrect dead code this is a focused, current rebuild covering the
 * settings that actually matter for a working app:
 *
 *   - Profile        — your name + location (feeds memory & weather)
 *   - AI Providers   — enter/update the API key for each provider
 *   - Engines        — assign a provider+model to the Companion and Worker
 *   - Pairing/Health — the existing RemoteControl / DeviceLink / Health panels
 *
 * Everything persists through the same IPC the setup wizard uses
 * (`providers:save`, `settings:save`) and mirrors into the Zustand store so the
 * rest of the app sees changes immediately.
 */

import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import type { AIProvider } from '../../types';
import { PROVIDERS, AVAILABLE_MODELS, formatPrice } from '../../providers/models';
import { toast } from '../ui/Toast';
import RemoteControlPanel from './RemoteControlPanel';
import DeviceLinkPanel from './DeviceLinkPanel';
import HealthPanel from './HealthPanel';
import {
  CODER_ENGINE_LABELS,
  CODER_ENGINE_SETTING_KEY,
  coderAvailable,
  getCoderStatus,
  isCoderEngineChoice,
  type CoderEngineChoice,
} from '../../henry/coderEngine';

// Providers that take an API key and can drive chat. (Ollama is local/keyless.)
const CLOUD_PROVIDER_IDS = ['openai', 'anthropic', 'google', 'groq'] as const;

const inputCls =
  'w-full bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm ' +
  'text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-all';
const labelCls = 'block text-xs font-medium text-henry-text-dim mb-1';
const cardCls = 'bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-4';
const btnCls =
  'px-3 py-1.5 rounded-lg text-xs font-medium bg-henry-accent/20 text-henry-accent ' +
  'hover:bg-henry-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** Refresh the store's providers list from the DB (post-save). */
async function refreshProviders(setProviders: (p: AIProvider[]) => void) {
  try {
    const raw = await window.henryAPI.getProviders?.();
    if (!raw) return;
    setProviders(
      raw.map((p) => ({
        id: p.id,
        name: p.name,
        apiKey: p.api_key ?? p.apiKey ?? '',
        enabled: Boolean(p.enabled),
        models: Array.isArray(p.models)
          ? p.models
          : ((): string[] => { try { return JSON.parse(p.models || '[]'); } catch { return []; } })(),
      })),
    );
  } catch {
    /* non-fatal — store keeps its current value */
  }
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-henry-text">{title}</h2>
      {sub && <p className="text-[11px] text-henry-text-muted mt-0.5 leading-relaxed">{sub}</p>}
    </div>
  );
}

// ── Profile ──────────────────────────────────────────────────────────────────

function ProfileSection() {
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const [name, setName] = useState(settings.owner_name || settings.user_name || '');
  const [location, setLocation] = useState(settings.location || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const pairs: Array<[string, string]> = [
        ['owner_name', name.trim()],
        ['user_name', name.trim()],
        ['location', location.trim()],
      ];
      for (const [k, v] of pairs) {
        await window.henryAPI.saveSetting?.(k, v);
        updateSetting(k, v);
      }
      toast.success('Profile saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save profile');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cardCls}>
      <SectionHeader title="Profile" sub="Henry uses these for memory and local context like weather." />
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Your name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Topher" />
        </div>
        <div>
          <label className={labelCls}>Location</label>
          <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Portland, OR" />
        </div>
        <button className={btnCls} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </div>
    </div>
  );
}

// ── AI Providers (API keys) ──────────────────────────────────────────────────

function ProviderKeyRow({ providerId }: { providerId: (typeof CLOUD_PROVIDER_IDS)[number] }) {
  const meta = PROVIDERS[providerId];
  const providers = useStore((s) => s.providers);
  const setProviders = useStore((s) => s.setProviders);
  const existing = providers.find((p) => p.id === providerId);
  const hasKey = Boolean(existing?.apiKey);

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const key = value.trim();
    if (!key) return;
    setBusy(true);
    try {
      const models = AVAILABLE_MODELS.filter((m) => m.provider === providerId).map((m) => m.id);
      await window.henryAPI.saveProvider?.({
        id: providerId,
        name: meta.name,
        apiKey: key,
        enabled: true,
        models: JSON.stringify(models),
      });
      await refreshProviders(setProviders);
      setValue('');
      toast.success(`${meta.name} key saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save key');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-henry-border/20 last:border-0">
      <span className="text-lg leading-none mt-0.5" aria-hidden>{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-henry-text">{meta.name}</span>
          {hasKey ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">key set</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-henry-border/30 text-henry-text-muted">no key</span>
          )}
        </div>
        <div className="flex gap-2 mt-1.5">
          <input
            type="password"
            className={inputCls + ' flex-1'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={hasKey ? 'Enter a new key to replace…' : `${meta.keyPrefix ?? ''}…`}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          />
          <button className={btnCls} onClick={save} disabled={busy || !value.trim()}>
            {busy ? 'Saving…' : hasKey ? 'Replace' : 'Save'}
          </button>
        </div>
        {meta.keyUrl && (
          <a
            href={meta.keyUrl}
            onClick={(e) => { e.preventDefault(); window.henryAPI.computerOpenUrl?.(meta.keyUrl); }}
            className="text-[10px] text-henry-text-muted hover:text-henry-accent mt-1 inline-block"
          >
            Get a {meta.name} key →
          </a>
        )}
      </div>
    </div>
  );
}

function ProvidersSection() {
  return (
    <div className={cardCls}>
      <SectionHeader title="AI Providers" sub="Keys are stored locally on this device. Add at least one to use Henry." />
      <div>
        {CLOUD_PROVIDER_IDS.map((id) => <ProviderKeyRow key={id} providerId={id} />)}
      </div>
    </div>
  );
}

// ── Engine assignment ────────────────────────────────────────────────────────

function EngineRow({ engine, label, hint }: { engine: 'companion' | 'worker'; label: string; hint: string }) {
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const providers = useStore((s) => s.providers);
  const configuredIds = new Set(providers.filter((p) => p.apiKey || p.id === 'ollama').map((p) => p.id));

  const currentProvider = settings[`${engine}_provider`] || '';
  const currentModel = settings[`${engine}_model`] || '';

  // Only offer models from providers that actually have a key (plus Ollama).
  const models = AVAILABLE_MODELS.filter(
    (m) => configuredIds.size === 0 || configuredIds.has(m.provider),
  );

  const onPick = async (modelId: string) => {
    const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!model) return;
    try {
      await window.henryAPI.saveSetting?.(`${engine}_provider`, model.provider);
      await window.henryAPI.saveSetting?.(`${engine}_model`, model.id);
      updateSetting(`${engine}_provider`, model.provider);
      updateSetting(`${engine}_model`, model.id);
      toast.success(`${label} → ${model.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set engine');
    }
  };

  return (
    <div className="py-2.5 border-b border-henry-border/20 last:border-0">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-henry-text">{label}</span>
        <span className="text-[10px] text-henry-text-muted">{currentProvider || 'unset'}</span>
      </div>
      <p className="text-[11px] text-henry-text-muted mb-1.5">{hint}</p>
      <select className={inputCls} value={currentModel} onChange={(e) => onPick(e.target.value)}>
        <option value="" disabled>Choose a model…</option>
        {models.map((m) => (
          <option key={`${m.provider}:${m.id}`} value={m.id}>
            {PROVIDERS[m.provider as keyof typeof PROVIDERS]?.name ?? m.provider} — {m.name}
            {m.inputPricePer1M != null ? ` (${formatPrice(m.inputPricePer1M)}/1M in)` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function EnginesSection() {
  return (
    <div className={cardCls}>
      <SectionHeader
        title="Engines"
        sub="Companion is the chat brain you talk to. Worker runs background tasks and Routines."
      />
      <div>
        <EngineRow engine="companion" label="Companion engine" hint="Used for live conversation in Chat." />
        <EngineRow engine="worker" label="Worker engine" hint="Used for tasks, the queue, and scheduled Routines." />
      </div>
    </div>
  );
}

// ── Coder Engine ─────────────────────────────────────────────────────────────

function CoderEngineSection() {
  const settings = useStore((s) => s.settings);
  const updateSetting = useStore((s) => s.updateSetting);
  const [status, setStatus] = useState<HenryCoderStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const choice: CoderEngineChoice = isCoderEngineChoice(settings[CODER_ENGINE_SETTING_KEY])
    ? (settings[CODER_ENGINE_SETTING_KEY] as CoderEngineChoice)
    : 'auto';

  const refresh = async (force = false) => {
    setChecking(true);
    try {
      setStatus(await getCoderStatus(force));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (coderAvailable()) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!coderAvailable()) return null;

  const pick = async (value: string) => {
    if (!isCoderEngineChoice(value)) return;
    try {
      await window.henryAPI.saveSetting?.(CODER_ENGINE_SETTING_KEY, value);
      updateSetting(CODER_ENGINE_SETTING_KEY, value);
      toast.success(`Coder engine → ${CODER_ENGINE_LABELS[value]}`);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set coder engine');
    }
  };

  return (
    <div className={cardCls}>
      <SectionHeader
        title="Coder Engine"
        sub="Code mode in chat writes code with the Claude Code CLI (your Claude subscription — big context, edits files) or a free local model via Ollama."
      />
      <div className="space-y-3">
        <select className={inputCls} value={choice} onChange={(e) => void pick(e.target.value)}>
          <option value="auto">Auto — Claude Code when installed, else local (recommended)</option>
          <option value="claude-code">Claude Code CLI only</option>
          <option value="local">Local only — free qwen coder via Ollama</option>
        </select>

        <div className="text-[11px] text-henry-text-muted space-y-1">
          <div>
            Claude Code CLI:{' '}
            {status?.claude.available ? (
              <span className="text-emerald-400">detected — {status.claude.version ?? 'installed'}</span>
            ) : (
              <span>
                not found — install with{' '}
                <span className="text-henry-text-dim">npm install -g @anthropic-ai/claude-code</span>
              </span>
            )}
          </div>
          <div>
            Local coder:{' '}
            {status?.local.model ? (
              <span className="text-emerald-400">{status.local.model} installed</span>
            ) : status?.local.ollamaRunning ? (
              <span>model missing — {status.local.hint ?? 'run: ollama pull qwen2.5-coder:7b'}</span>
            ) : (
              <span>{status?.local.hint ?? 'Ollama not running'}</span>
            )}
          </div>
          {status && (
            <div>
              Active now:{' '}
              <span className="text-henry-text-dim">
                {status.active === 'none' ? 'no engine available' : status.active === 'claude-code' ? 'Claude Code' : `Local (${status.local.model})`}
              </span>
              {' · '}Auto-applied edits are limited to{' '}
              <span className="text-henry-text-dim">~/HenryAI/coder-projects</span>
            </div>
          )}
        </div>

        <button className={btnCls} onClick={() => void refresh(true)} disabled={checking}>
          {checking ? 'Checking…' : 'Re-check'}
        </button>
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function SettingsView() {
  return (
    <div className="h-full overflow-y-auto bg-henry-bg">
      <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-henry-text">Settings</h1>
          <p className="text-xs text-henry-text-muted mt-1">
            Profile, AI providers, engine assignment, pairing, and system health.
          </p>
        </div>

        <ProfileSection />
        <ProvidersSection />
        <EnginesSection />
        <CoderEngineSection />

        <div className={cardCls}>
          <SectionHeader title="Companion device" sub="Pair and control Henry from your phone." />
          <div className="space-y-5">
            <RemoteControlPanel />
            <DeviceLinkPanel />
          </div>
        </div>

        <div className={cardCls}>
          <SectionHeader title="System health" />
          <HealthPanel />
        </div>
      </div>
    </div>
  );
}
