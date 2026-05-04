/**
 * Henry Proxy Usage Tracker
 * Tracks free tier usage client-side + syncs with proxy for accurate count.
 * Shows users how many requests remain today.
 */

const USAGE_KEY = 'henry:proxy_usage';
const PROXY_URL = 'https://henry-proxy.henryai.workers.dev';

interface UsageData {
  date: string;
  used: number;
  limit: number;
  lastSync: string;
}

export function getDeviceId(): string {
  let id = localStorage.getItem('henry:device_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('henry:device_id', id); }
  return id;
}

export function getLicenseKey(): string {
  return localStorage.getItem('henry:license_key') || '';
}

export function setLicenseKey(key: string): void {
  localStorage.setItem('henry:license_key', key);
}

export function getTodayUsage(): UsageData {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as UsageData;
      if (d.date === today) return d;
    }
  } catch { /* ignore */ }
  return { date: today, used: 0, limit: 50, lastSync: '' };
}

export function incrementUsage(): void {
  const d = getTodayUsage();
  d.used = Math.min(d.used + 1, d.limit + 1);
  localStorage.setItem(USAGE_KEY, JSON.stringify(d));
}

export async function syncUsageFromProxy(): Promise<UsageData> {
  try {
    const deviceId = getDeviceId();
    const licenseKey = getLicenseKey();
    const r = await fetch(PROXY_URL + '/v1/usage', {
      headers: {
        'X-Henry-Device': deviceId,
        ...(licenseKey ? { 'X-Henry-License': licenseKey } : {}),
      },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const data = await r.json() as { used: number; limit: number; date: string; remaining: number };
      const today = new Date().toISOString().slice(0, 10);
      const usage: UsageData = {
        date: today,
        used: data.used || 0,
        limit: data.limit || 50,
        lastSync: new Date().toISOString(),
      };
      localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
      return usage;
    }
  } catch { /* proxy unavailable — use local count */ }
  return getTodayUsage();
}

export function getUsagePercent(): number {
  const d = getTodayUsage();
  return Math.min(100, Math.round((d.used / d.limit) * 100));
}

export function getRemainingRequests(): number {
  const d = getTodayUsage();
  return Math.max(0, d.limit - d.used);
}

export function isNearLimit(): boolean {
  return getRemainingRequests() <= 10;
}

export function isAtLimit(): boolean {
  return getRemainingRequests() <= 0;
}
