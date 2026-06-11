/**
 * SlicerPanel — P1 of the slicer (slicer plan). Configure the CuraEngine binary,
 * slice an STL/3MF/OBJ, and see the time + filament estimate. The engine is a
 * proven open-source slicer Henry drives as a subprocess; Henry's AI-assisted
 * profiles + send-to-printer come in later phases.
 *
 * The engine binary + definitions live on the Mac and are configured here once.
 */

import { useCallback, useEffect, useState } from 'react';

interface Status {
  available: boolean;
  missing: string[];
  version?: string;
  enginePath?: string;
  definitionsDir?: string;
  printerDef?: string;
}

function api() {
  return typeof window !== 'undefined' ? window.henryAPI : undefined;
}

function fmtTime(sec?: number): string {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const input = 'w-full bg-henry-surface border border-henry-border/30 rounded-lg px-2.5 py-1.5 text-xs text-henry-text font-mono outline-none focus:border-henry-accent/50';

export default function SlicerPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  // setup fields
  const [enginePath, setEnginePath] = useState('');
  const [defsDir, setDefsDir] = useState('');
  const [printerDef, setPrinterDef] = useState('');
  const [savingSetup, setSavingSetup] = useState(false);

  // slice fields
  const [modelPath, setModelPath] = useState('');
  const [layerHeight, setLayerHeight] = useState('0.2');
  const [infill, setInfill] = useState('20');
  const [slicing, setSlicing] = useState(false);
  const [result, setResult] = useState<{ gcodePath: string; estimate: { timeSeconds?: number; filamentMm?: number; filamentGrams?: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api()?.slicerStatus?.();
      if (res?.ok && res.result) {
        setStatus(res.result);
        setEnginePath(res.result.enginePath || '');
        setDefsDir(res.result.definitionsDir || '');
        setPrinterDef(res.result.printerDef || '');
      } else {
        setStatus(null);
        setError(res?.error || 'Slicer is only available in the desktop app.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveSetup = useCallback(async () => {
    setSavingSetup(true);
    try {
      await api()?.saveSetting?.('slicer_engine_path', enginePath.trim());
      await api()?.saveSetting?.('slicer_definitions_dir', defsDir.trim());
      await api()?.saveSetting?.('slicer_printer_def', printerDef.trim());
      await refresh();
    } finally {
      setSavingSetup(false);
    }
  }, [enginePath, defsDir, printerDef, refresh]);

  const slice = useCallback(async () => {
    if (!modelPath.trim() || slicing) return;
    setSlicing(true);
    setError(null);
    setResult(null);
    try {
      const res = await api()?.slicerSlice?.({
        modelPath: modelPath.trim(),
        settings: { layer_height: layerHeight, infill_sparse_density: infill },
      });
      if (res?.ok && res.result) setResult(res.result);
      else setError(res?.error || 'Slice failed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Slice failed.');
    } finally {
      setSlicing(false);
    }
  }, [modelPath, layerHeight, infill, slicing]);

  return (
    <div className="h-full overflow-y-auto bg-henry-bg">
      <div className="max-w-2xl mx-auto px-5 py-6">
        <h1 className="text-xl font-semibold text-henry-text">Slice</h1>
        <p className="text-xs text-henry-text-muted mb-5">
          Turn a 3D model into printer-ready G-code. Henry drives a proven slicing engine (CuraEngine) under the hood.
        </p>

        {loading && <div className="text-sm text-henry-text-muted py-10 text-center">Checking the engine…</div>}

        {!loading && status && !status.available && (
          <div className="bg-henry-surface/40 border border-amber-500/30 rounded-2xl p-4 mb-5">
            <h2 className="text-sm font-semibold text-henry-text">Set up the engine</h2>
            <p className="text-[11px] text-henry-text-muted mt-0.5 mb-3">
              Missing: {status.missing.join(', ')}. Install CuraEngine on this Mac, then point Henry at it.
            </p>
            <div className="space-y-2">
              <label className="block text-[11px] text-henry-text-dim">CuraEngine binary path</label>
              <input className={input} value={enginePath} onChange={(e) => setEnginePath(e.target.value)} placeholder="/opt/homebrew/bin/CuraEngine" />
              <label className="block text-[11px] text-henry-text-dim">Definitions folder</label>
              <input className={input} value={defsDir} onChange={(e) => setDefsDir(e.target.value)} placeholder="…/share/cura/resources/definitions" />
              <label className="block text-[11px] text-henry-text-dim">Printer definition (.def.json)</label>
              <input className={input} value={printerDef} onChange={(e) => setPrinterDef(e.target.value)} placeholder="…/definitions/creality_ender3.def.json" />
              <button onClick={() => void saveSetup()} disabled={savingSetup} className="mt-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-henry-accent/20 text-henry-accent hover:bg-henry-accent/30 disabled:opacity-40">
                {savingSetup ? 'Saving…' : 'Save & check'}
              </button>
            </div>
          </div>
        )}

        {!loading && status?.available && (
          <>
            <div className="flex items-center gap-2 mb-4 text-[11px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Engine ready{status.version ? ` · ${status.version}` : ''}
              <button onClick={() => void refresh()} className="ml-auto text-henry-text-muted hover:text-henry-text">Re-check</button>
            </div>

            <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-4 space-y-3">
              <div>
                <label className="block text-[11px] text-henry-text-dim mb-1">Model file (.stl / .3mf / .obj)</label>
                <input className={input} value={modelPath} onChange={(e) => setModelPath(e.target.value)} placeholder="/Users/you/Desktop/part.stl" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-henry-text-dim mb-1">Layer height (mm)</label>
                  <input className={input} value={layerHeight} onChange={(e) => setLayerHeight(e.target.value)} />
                </div>
                <div>
                  <label className="block text-[11px] text-henry-text-dim mb-1">Infill (%)</label>
                  <input className={input} value={infill} onChange={(e) => setInfill(e.target.value)} />
                </div>
              </div>
              <button onClick={() => void slice()} disabled={slicing || !modelPath.trim()} className="px-4 py-2 rounded-xl text-sm font-medium bg-henry-accent/20 text-henry-accent hover:bg-henry-accent/30 disabled:opacity-40 disabled:cursor-not-allowed">
                {slicing ? 'Slicing…' : 'Slice'}
              </button>
            </div>

            {error && <div className="mt-4 bg-henry-surface/50 border border-red-500/30 rounded-xl p-3 text-sm text-red-300">{error}</div>}

            {result && (
              <div className="mt-4 bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-4">
                <h3 className="text-sm font-semibold text-henry-text mb-2">Sliced ✓</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Est. print time" value={fmtTime(result.estimate.timeSeconds)} />
                  <Stat label="Filament" value={result.estimate.filamentMm ? `${(result.estimate.filamentMm / 1000).toFixed(2)} m${result.estimate.filamentGrams ? ` · ${result.estimate.filamentGrams} g` : ''}` : '—'} />
                </div>
                <p className="text-[10px] text-henry-text-muted mt-3 font-mono break-all">{result.gcodePath}</p>
                <p className="text-[10px] text-henry-text-muted mt-1">Send-to-printer + AI-assisted settings come in the next phases.</p>
              </div>
            )}
          </>
        )}

        {!loading && !status && error && (
          <div className="bg-henry-surface/50 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">{error}</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-henry-surface/50 rounded-lg px-3 py-2">
      <div className="text-sm text-henry-text">{value}</div>
      <div className="text-[10px] text-henry-text-muted mt-0.5">{label}</div>
    </div>
  );
}
