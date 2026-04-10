import { useCallback, useEffect, useState } from 'react';
import { lookupScripture } from '@/henry/scriptureLookup';
import type { ScriptureLookupResult } from '@/henry/scriptureLookup';
import { importHenrySampleScripture } from '@/henry/sampleScripture.fixture';
import { importScriptureJson } from '@/henry/scriptureImport';
import {
  buildStudyChatPromptFromLookup,
  buildUseInChatReferenceLine,
} from '@/henry/studyNoteScaffold';
import { CHAPTER_VERSE_PLACEHOLDER_END } from '@/henry/scriptureReference';

interface ScriptureToolsPanelProps {
  onInjectChat: (text: string) => void;
  onRequestExportPack?: () => void;
  disabled?: boolean;
}

function formatParsedRef(r: ScriptureLookupResult): string {
  const p = r.parsed;
  if (!p) return '—';
  if (p.verseEnd === CHAPTER_VERSE_PLACEHOLDER_END) {
    return `${p.book} ${p.chapter} (whole chapter)`;
  }
  return `${p.book} ${p.chapter}:${p.verseStart}${p.verseEnd !== p.verseStart ? `–${p.verseEnd}` : ''}`;
}

export default function ScriptureToolsPanel({
  onInjectChat,
  onRequestExportPack,
  disabled,
}: ScriptureToolsPanelProps) {
  const [count, setCount] = useState<number | null>(null);
  const [lookupInput, setLookupInput] = useState('');
  const [result, setResult] = useState<ScriptureLookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const n = await window.henryAPI.scriptureCount();
      setCount(typeof n === 'number' ? n : 0);
    } catch {
      setCount(null);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  async function runLookup() {
    const q = lookupInput.trim();
    if (!q || disabled) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await lookupScripture(q);
      setResult(res);
    } catch (e: unknown) {
      setResult(null);
      setStatus(`Lookup failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleImportSample() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await importHenrySampleScripture();
      const errPart = r.errors.length ? ` Warnings: ${r.errors.slice(0, 3).join('; ')}` : '';
      setStatus(`Imported ${r.imported} row(s).${errPart}`);
      await refreshCount();
    } catch (e: unknown) {
      setStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile() {
    setBusy(true);
    setStatus(null);
    try {
      const pick = await window.henryAPI.pickScriptureImportJson();
      if (pick.canceled) {
        setStatus(null);
        setBusy(false);
        return;
      }
      if ('error' in pick && pick.error) {
        setStatus(`Could not read file: ${pick.error}`);
        setBusy(false);
        return;
      }
      if (!pick.content?.trim()) {
        setStatus('Empty file.');
        setBusy(false);
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(pick.content) as unknown;
      } catch {
        setStatus('Invalid JSON.');
        setBusy(false);
        return;
      }
      const r = await importScriptureJson(data);
      const errPart = r.errors.length ? ` Notes: ${r.errors.slice(0, 3).join('; ')}` : '';
      setStatus(`Imported ${r.imported} row(s).${errPart}`);
      await refreshCount();
    } catch (e: unknown) {
      setStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const useLine = result ? buildUseInChatReferenceLine(result) : null;
  const studyPrompt = result ? buildStudyChatPromptFromLookup(result) : null;

  return (
    <div className="rounded-xl border border-henry-border/35 bg-henry-surface/20 px-4 py-3 mb-3 text-xs text-henry-text">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="font-semibold text-henry-text tracking-wide uppercase text-[10px] text-henry-text-muted">
          Scripture tools
        </span>
        <span className="text-henry-text-dim">
          {count === null
            ? '…'
            : count > 0
              ? `Local store: ${count} entr${count === 1 ? 'y' : 'ies'}`
              : 'No scripture entries imported yet'}
        </span>
      </div>
      <p className="text-[10px] text-henry-text-muted mb-2">
        {count !== null && count > 0
          ? 'Local scripture store ready.'
          : 'Import sample or JSON to enable lookup in chat.'}
      </p>

      <div className="flex flex-wrap gap-2 mb-3">
        {onRequestExportPack && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={onRequestExportPack}
            className="px-2 py-1 rounded-lg border border-henry-accent/35 bg-henry-accent/10 text-henry-accent text-[11px] hover:bg-henry-accent/20 disabled:opacity-40"
          >
            Export pack
          </button>
        )}
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void handleImportSample()}
          className="px-2 py-1 rounded-lg border border-henry-border/50 bg-henry-surface/40 hover:bg-henry-surface/60 disabled:opacity-40 text-[11px]"
        >
          Import sample
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void handleImportFile()}
          className="px-2 py-1 rounded-lg border border-henry-border/50 bg-henry-surface/40 hover:bg-henry-surface/60 disabled:opacity-40 text-[11px]"
        >
          Import JSON file…
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void refreshCount()}
          className="px-2 py-1 rounded-lg border border-henry-border/40 text-henry-text-muted hover:text-henry-text text-[11px]"
        >
          Refresh count
        </button>
      </div>

      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={lookupInput}
          onChange={(e) => setLookupInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void runLookup()}
          placeholder="John 3:16"
          disabled={disabled || busy}
          className="flex-1 min-w-[8rem] rounded-lg border border-henry-border/40 bg-henry-bg/60 px-2 py-1.5 text-xs text-henry-text placeholder:text-henry-text-muted"
          aria-label="Scripture reference lookup"
        />
        <button
          type="button"
          disabled={disabled || busy || !lookupInput.trim()}
          onClick={() => void runLookup()}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-henry-accent/90 text-white text-[11px] font-medium hover:bg-henry-accent disabled:opacity-40"
        >
          Lookup
        </button>
      </div>

      {status && <p className="text-[10px] text-henry-text-dim mb-2 whitespace-pre-wrap">{status}</p>}

      {result && (
        <div className="mt-2 rounded-lg border border-henry-border/30 bg-henry-bg/40 p-2 space-y-1.5">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            <span>
              <span className="text-henry-text-muted">Parsed: </span>
              {formatParsedRef(result)}
            </span>
            <span>
              <span className="text-henry-text-muted">Key: </span>
              <code className="text-henry-text-dim">{result.normalizedReference ?? '—'}</code>
            </span>
            <span className={result.found ? 'text-green-400/90' : 'text-amber-400/90'}>
              {result.found ? 'Found' : 'Not found'}
            </span>
          </div>
          {result.found && result.text && (
            <>
              <p className="text-[10px] text-henry-text-muted">
                Source: {result.sourceLabel ?? result.sourceProfileId ?? 'unspecified'}
              </p>
              <blockquote className="text-[11px] leading-relaxed border-l-2 border-henry-accent/40 pl-2 my-1 whitespace-pre-wrap">
                {result.text}
              </blockquote>
            </>
          )}
          {!result.found && result.parsed && (
            <p className="text-[10px] text-henry-text-dim">{result.guidance}</p>
          )}
          {result.parseError && (
            <p className="text-[10px] text-henry-text-dim">{result.parseError}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {useLine && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onInjectChat(useLine)}
                className="px-2 py-1 rounded-md border border-henry-border/50 text-[10px] hover:bg-henry-surface/50"
              >
                Use in chat
              </button>
            )}
            {studyPrompt && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onInjectChat(studyPrompt)}
                className="px-2 py-1 rounded-md border border-henry-border/50 text-[10px] hover:bg-henry-surface/50"
              >
                Start study note
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
