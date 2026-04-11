export type ClientStatus = 'prospect' | 'active' | 'paused' | 'closed';
export type ProjectStatus = 'planning' | 'active' | 'review' | 'complete' | 'on-hold';

export interface CRMClient {
  id: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  status: ClientStatus;
  tags: string[];
  notes: string;
  value?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CRMProject {
  id: string;
  clientId?: string;
  name: string;
  status: ProjectStatus;
  value?: number;
  deadline?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CRMInteraction {
  id: string;
  clientId: string;
  type: 'call' | 'email' | 'meeting' | 'note' | 'follow-up';
  summary: string;
  date: string;
}

const CLIENTS_KEY = 'henry:crm:clients';
const PROJECTS_KEY = 'henry:crm:projects';
const INTERACTIONS_KEY = 'henry:crm:interactions';

function load<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function save<T>(key: string, items: T[]) {
  localStorage.setItem(key, JSON.stringify(items));
}

export const loadClients = () => load<CRMClient>(CLIENTS_KEY);
export const loadProjects = () => load<CRMProject>(PROJECTS_KEY);
export const loadInteractions = () => load<CRMInteraction>(INTERACTIONS_KEY);

export function saveClient(c: CRMClient) {
  const all = loadClients();
  const idx = all.findIndex((x) => x.id === c.id);
  const updated = { ...c, updatedAt: new Date().toISOString() };
  if (idx >= 0) all[idx] = updated; else all.unshift(updated);
  save(CLIENTS_KEY, all);
}
export function deleteClient(id: string) { save(CLIENTS_KEY, loadClients().filter((c) => c.id !== id)); }

export function saveProject(p: CRMProject) {
  const all = loadProjects();
  const idx = all.findIndex((x) => x.id === p.id);
  const updated = { ...p, updatedAt: new Date().toISOString() };
  if (idx >= 0) all[idx] = updated; else all.unshift(updated);
  save(PROJECTS_KEY, all);
}
export function deleteProject(id: string) { save(PROJECTS_KEY, loadProjects().filter((p) => p.id !== id)); }

export function addInteraction(i: CRMInteraction) {
  const all = loadInteractions();
  all.unshift(i);
  save(INTERACTIONS_KEY, all);
}
export function getClientInteractions(clientId: string) {
  return loadInteractions().filter((i) => i.clientId === clientId);
}

export function newClient(): CRMClient {
  return { id: `client_${Date.now()}`, name: '', status: 'prospect', tags: [], notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
export function newProject(clientId?: string): CRMProject {
  return { id: `proj_${Date.now()}`, clientId, name: '', status: 'planning', notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export const STATUS_META: Record<ClientStatus, { label: string; color: string }> = {
  prospect: { label: 'Prospect', color: 'text-amber-400 bg-amber-400/10' },
  active: { label: 'Active', color: 'text-emerald-400 bg-emerald-400/10' },
  paused: { label: 'Paused', color: 'text-henry-text-muted bg-henry-surface' },
  closed: { label: 'Closed', color: 'text-henry-text-dim bg-henry-surface/50' },
};

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'text-sky-400 bg-sky-400/10' },
  active: { label: 'Active', color: 'text-emerald-400 bg-emerald-400/10' },
  review: { label: 'In review', color: 'text-violet-400 bg-violet-400/10' },
  complete: { label: 'Complete', color: 'text-henry-text-muted bg-henry-surface' },
  'on-hold': { label: 'On hold', color: 'text-amber-400 bg-amber-400/10' },
};
