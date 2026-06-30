/**
 * Synatra bridge (Henry ↔ Synatra).
 *
 * Henry's `synatra_run` / `synatra_status` tools drive Synatra — an AI-agent
 * workspace on Temporal — as the orchestration + dashboard layer for background
 * **video-generation** jobs. Unlike `browserBridge.ts` (which spawns a local
 * Python subprocess), Synatra runs as a separate service, so this bridge is a
 * thin, authenticated HTTP client: it POSTs a job to a Synatra *webhook trigger*
 * and GETs the resulting *thread* to poll status.
 *
 * Config lives in Henry's own DB (set in Settings, never hard-coded):
 *   settings.synatra_endpoint   → base URL        (e.g. http://localhost:8787)
 *   settings.synatra_org        → org slug
 *   settings.synatra_env        → environment slug (e.g. dev)
 *   settings.synatra_trigger    → trigger slug     (e.g. render-video)
 *   providers['synatra'].api_key → webhook Bearer secret (encrypted at rest)
 *
 * Security: the endpoint is an explicitly user-configured, trusted local/remote
 * Synatra instance — by design it is usually `localhost:8787`. So this bridge
 * does NOT apply the SSRF guard used by `web.ts` (which exists to stop a
 * model/user-supplied URL from reaching internal addresses). The secret is sent
 * in an `Authorization: Bearer` header, never in argv or a query string.
 */

import type Database from "better-sqlite3";
import { decryptKey } from "../ipc/_keyStorage";

export interface SynatraConfig {
  endpoint: string;
  org: string;
  env: string;
  trigger: string;
  secret: string;
  /**
   * Optional better-auth session token. The webhook (submit) authenticates with
   * the `secret`, but reading a thread's status (`GET /api/threads/:id`) is
   * session-authed, not secret-authed — so polling needs this signed session
   * cookie value. Stored in settings as `synatra_session_token`.
   */
  sessionToken?: string;
}

export interface SynatraJobPayload {
  prompt: string;
  durationSec?: number;
  style?: string;
  outputName?: string;
}

export interface SynatraSubmitResult {
  ok: boolean;
  threadId?: string;
  status?: string;
  error?: string;
}

export interface SynatraStatusResult {
  ok: boolean;
  threadId?: string;
  status?: string; // running | waiting_human | completed | failed | cancelled | …
  result?: unknown;
  error?: string;
  /** Convenience flags derived from `status`. */
  done?: boolean;
  failed?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Read a single settings value, or '' if missing. */
function setting(db: Database.Database, key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return (row?.value ?? "").trim();
}

/**
 * Pull the Synatra connection config out of Henry's DB. Returns `null` with a
 * human reason when something required is missing, so the tool layer can hand
 * the model a clean "configure it in Settings" message.
 */
export function resolveSynatraConfig(
  db: Database.Database,
): { ok: true; config: SynatraConfig } | { ok: false; reason: string } {
  const endpoint = setting(db, "synatra_endpoint").replace(/\/+$/, "");
  const org = setting(db, "synatra_org");
  const env = setting(db, "synatra_env");
  const trigger = setting(db, "synatra_trigger");

  const provider = db
    .prepare("SELECT api_key, enabled FROM providers WHERE id = 'synatra'")
    .get() as { api_key: string; enabled: number } | undefined;

  if (!provider || provider.enabled !== 1) {
    return { ok: false, reason: "Synatra is not enabled. Enable it in Settings → AI Providers." };
  }
  const secret = decryptKey(provider.api_key ?? "");

  const missing: string[] = [];
  if (!endpoint) missing.push("endpoint URL");
  if (!org) missing.push("org slug");
  if (!env) missing.push("environment slug");
  if (!trigger) missing.push("trigger slug");
  if (!secret) missing.push("webhook secret");
  if (missing.length) {
    return {
      ok: false,
      reason: `Synatra is missing its ${missing.join(", ")}. Set these in Settings → Synatra.`,
    };
  }

  const sessionToken = setting(db, "synatra_session_token") || undefined;

  return { ok: true, config: { endpoint, org, env, trigger, secret, sessionToken } };
}

/** True when Synatra is configured enough to call — for a clean pre-flight error. */
export function synatraAvailable(db: Database.Database): { ok: boolean; reason?: string } {
  const r = resolveSynatraConfig(db);
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

/** fetch with an AbortController timeout. Never depends on the SSRF-guarded path. */
async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      /* leave body as raw text */
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Submit one video job to Synatra's webhook trigger. Resolves with the created
 * `threadId`; never rejects — failures come back as `{ ok:false, error }`.
 */
export async function submitSynatraJob(
  config: SynatraConfig,
  payload: SynatraJobPayload,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SynatraSubmitResult> {
  const url = `${config.endpoint}/api/webhook/${encodeURIComponent(config.org)}/${encodeURIComponent(
    config.env,
  )}/${encodeURIComponent(config.trigger)}`;
  try {
    const { status, body } = await fetchJson(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.secret}`,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    );
    if (status < 200 || status >= 300) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      return { ok: false, error: `Synatra webhook returned HTTP ${status}: ${detail.slice(0, 300)}` };
    }
    const obj = (body ?? {}) as Record<string, unknown>;
    const threadId = String(obj.threadId ?? obj.thread_id ?? obj.id ?? "");
    if (!threadId) {
      return { ok: false, error: "Synatra accepted the job but returned no threadId." };
    }
    return { ok: true, threadId, status: String(obj.status ?? "active") };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /abort/i.test(msg);
    return { ok: false, error: timedOut ? `Synatra submit timed out after ${Math.round(timeoutMs / 1000)}s.` : msg };
  }
}

const DONE_STATUSES = new Set(["completed", "succeeded", "success"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "canceled", "rejected", "error"]);

/** Poll one job's thread for status/result. Never rejects. */
export async function pollSynatraJob(
  config: SynatraConfig,
  threadId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SynatraStatusResult> {
  const url = `${config.endpoint}/api/threads/${encodeURIComponent(threadId)}`;
  // Thread reads are session-authed: send the better-auth session cookie when we
  // have one. Without it, fall back to the secret (which Synatra will 401) so the
  // error message is actionable rather than a silent misconfig.
  const headers: Record<string, string> = config.sessionToken
    ? { Cookie: `better-auth.session_token=${config.sessionToken}` }
    : { Authorization: `Bearer ${config.secret}` };
  try {
    const { status, body } = await fetchJson(url, { method: "GET", headers }, timeoutMs);
    if (status < 200 || status >= 300) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      return { ok: false, error: `Synatra thread fetch returned HTTP ${status}: ${detail.slice(0, 300)}` };
    }
    const obj = (body ?? {}) as Record<string, unknown>;
    const s = String(obj.status ?? "running").toLowerCase();
    return {
      ok: true,
      threadId,
      status: s,
      result: obj.result,
      error: obj.error ? String(obj.error) : undefined,
      done: DONE_STATUSES.has(s),
      failed: FAILED_STATUSES.has(s),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /abort/i.test(msg);
    return { ok: false, error: timedOut ? `Synatra poll timed out after ${Math.round(timeoutMs / 1000)}s.` : msg };
  }
}
