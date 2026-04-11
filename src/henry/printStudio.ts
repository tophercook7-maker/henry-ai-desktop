export type FilamentMaterial = 'PLA' | 'PETG' | 'ABS' | 'ASA' | 'TPU' | 'Nylon' | 'Resin' | 'Other';
export type BOMStatus = 'needed' | 'ordered' | 'in-hand' | 'used';

export interface PrintJob {
  id: string;
  name: string;
  date: string;
  material: string;
  color?: string;
  filamentSpoolId?: string;
  durationMinutes?: number;
  layerHeight?: number;
  infillPercent?: number;
  success: boolean;
  notes?: string;
  createdAt: string;
}

export interface FilamentSpool {
  id: string;
  brand: string;
  material: FilamentMaterial;
  color: string;
  colorHex?: string;
  weightGrams: number;
  remainingPercent: number;
  purchaseDate?: string;
  notes?: string;
}

export interface BOMItem {
  id: string;
  projectName: string;
  component: string;
  quantity: number;
  unit: string;
  source?: string;
  unitCost?: number;
  status: BOMStatus;
  notes?: string;
  createdAt: string;
}

const JOBS_KEY = 'henry:print:jobs';
const SPOOLS_KEY = 'henry:print:spools';
const BOM_KEY = 'henry:print:bom';

function load<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function save<T>(key: string, items: T[]) { localStorage.setItem(key, JSON.stringify(items)); }

export const loadJobs = () => load<PrintJob>(JOBS_KEY);
export const loadSpools = () => load<FilamentSpool>(SPOOLS_KEY);
export const loadBOM = () => load<BOMItem>(BOM_KEY);

export function saveJob(j: PrintJob) {
  const all = loadJobs();
  const idx = all.findIndex((x) => x.id === j.id);
  if (idx >= 0) all[idx] = j; else all.unshift(j);
  save(JOBS_KEY, all);
}
export function deleteJob(id: string) { save(JOBS_KEY, loadJobs().filter((j) => j.id !== id)); }

export function saveSpool(s: FilamentSpool) {
  const all = loadSpools();
  const idx = all.findIndex((x) => x.id === s.id);
  if (idx >= 0) all[idx] = s; else all.unshift(s);
  save(SPOOLS_KEY, all);
}
export function deleteSpool(id: string) { save(SPOOLS_KEY, loadSpools().filter((s) => s.id !== id)); }

export function saveBOMItem(b: BOMItem) {
  const all = loadBOM();
  const idx = all.findIndex((x) => x.id === b.id);
  if (idx >= 0) all[idx] = b; else all.unshift(b);
  save(BOM_KEY, all);
}
export function deleteBOMItem(id: string) { save(BOM_KEY, loadBOM().filter((b) => b.id !== id)); }

export function newJob(): PrintJob {
  return { id: `job_${Date.now()}`, name: '', date: new Date().toISOString().slice(0, 10), material: 'PLA', success: true, createdAt: new Date().toISOString() };
}
export function newSpool(): FilamentSpool {
  return { id: `spool_${Date.now()}`, brand: '', material: 'PLA', color: '', weightGrams: 1000, remainingPercent: 100 };
}
export function newBOMItem(projectName = ''): BOMItem {
  return { id: `bom_${Date.now()}`, projectName, component: '', quantity: 1, unit: 'pcs', status: 'needed', createdAt: new Date().toISOString() };
}

export const MATERIAL_COLORS: Record<FilamentMaterial, string> = {
  PLA: 'text-emerald-400', PETG: 'text-sky-400', ABS: 'text-amber-400',
  ASA: 'text-orange-400', TPU: 'text-violet-400', Nylon: 'text-cyan-400',
  Resin: 'text-rose-400', Other: 'text-henry-text-muted',
};

export const BOM_STATUS_META: Record<BOMStatus, { label: string; color: string }> = {
  needed: { label: 'Needed', color: 'text-henry-error bg-henry-error/10' },
  ordered: { label: 'Ordered', color: 'text-amber-400 bg-amber-400/10' },
  'in-hand': { label: 'In hand', color: 'text-emerald-400 bg-emerald-400/10' },
  used: { label: 'Used', color: 'text-henry-text-muted bg-henry-surface' },
};

/** Build a context string about the print studio for Henry's system prompt */
export function buildPrintStudioContext(): string {
  const spools = loadSpools();
  if (!spools.length) return '';
  const spoolSummary = spools.map((s) => `${s.brand} ${s.material} ${s.color} (${s.remainingPercent}% remaining)`).join(', ');
  const jobs = loadJobs();
  const lastJob = jobs[0];
  return `3D Print Studio: ${spools.length} filament spool(s) available: ${spoolSummary}.${lastJob ? ` Last print: "${lastJob.name}" on ${lastJob.date}.` : ''}`;
}
