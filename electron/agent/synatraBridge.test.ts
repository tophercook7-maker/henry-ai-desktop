/**
 * Tests for the Synatra bridge + tools. Hermetic: `fetch` is stubbed and
 * `_keyStorage` (which pulls in Electron's safeStorage) is mocked, so these run
 * in plain vitest with no network and no Electron. They assert the HTTP contract
 * (URL, Bearer header, payload), config resolution, status mapping, and the
 * tool safety surface — the things that must not silently break.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// decryptKey would import Electron's safeStorage — mock it to identity.
vi.mock("../ipc/_keyStorage", () => ({
  decryptKey: (s: string | null | undefined) => s ?? "",
}));

import {
  resolveSynatraConfig,
  submitSynatraJob,
  pollSynatraJob,
} from "./synatraBridge";
import { synatraTools } from "./tools/synatra";

// ── Fake better-sqlite3 handle ────────────────────────────────────────────────
type Settings = Record<string, string>;
function makeDb(opts?: { settings?: Partial<Settings>; providerEnabled?: number; secret?: string; noProvider?: boolean }) {
  const settings: Settings = {
    synatra_endpoint: "http://localhost:8787",
    synatra_org: "myorg",
    synatra_env: "dev",
    synatra_trigger: "render-video",
    ...(opts?.settings ?? {}),
  };
  const provider = opts?.noProvider
    ? undefined
    : { api_key: opts?.secret ?? "the-secret", enabled: opts?.providerEnabled ?? 1 };
  return {
    prepare(sql: string) {
      return {
        get(arg?: unknown) {
          if (sql.includes("FROM settings")) {
            const v = settings[String(arg)];
            return v === undefined ? undefined : { value: v };
          }
          if (sql.includes("FROM providers")) return provider;
          return undefined;
        },
      };
    },
  } as any;
}

// ── fetch stub ────────────────────────────────────────────────────────────────
function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
  // @ts-expect-error test override
  global.fetch = fn;
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("resolveSynatraConfig", () => {
  it("returns the full config when everything is present + enabled", () => {
    const r = resolveSynatraConfig(makeDb());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config).toMatchObject({
        endpoint: "http://localhost:8787",
        org: "myorg",
        env: "dev",
        trigger: "render-video",
        secret: "the-secret",
      });
    }
  });

  it("fails when the provider is disabled", () => {
    const r = resolveSynatraConfig(makeDb({ providerEnabled: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not enabled/i);
  });

  it("fails (and names what's missing) when the org slug is blank", () => {
    const r = resolveSynatraConfig(makeDb({ settings: { synatra_org: "" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/org slug/i);
  });

  it("strips a trailing slash from the endpoint", () => {
    const r = resolveSynatraConfig(makeDb({ settings: { synatra_endpoint: "http://localhost:8787/" } }));
    expect(r.ok && r.config.endpoint).toBe("http://localhost:8787");
  });
});

describe("submitSynatraJob", () => {
  const cfg = { endpoint: "http://localhost:8787", org: "myorg", env: "dev", trigger: "render-video", secret: "s3cr3t" };

  it("POSTs to the webhook URL with a Bearer header + JSON body, and returns the threadId", async () => {
    const fn = stubFetch(202, { threadId: "thr_1", status: "active" });
    const res = await submitSynatraJob(cfg, { prompt: "a red car", durationSec: 10 });
    expect(res).toEqual({ ok: true, threadId: "thr_1", status: "active" });

    const [url, init] = fn.mock.calls[0] as unknown as [string, any];
    expect(url).toBe("http://localhost:8787/api/webhook/myorg/dev/render-video");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer s3cr3t");
    expect(JSON.parse(init.body)).toMatchObject({ prompt: "a red car", durationSec: 10 });
  });

  it("surfaces a non-2xx as an error (no threadId)", async () => {
    stubFetch(422, { error: "prompt is required" });
    const res = await submitSynatraJob(cfg, { prompt: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HTTP 422/);
  });

  it("errors cleanly when the body has no threadId", async () => {
    stubFetch(202, { status: "active" });
    const res = await submitSynatraJob(cfg, { prompt: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no threadId/i);
  });
});

describe("pollSynatraJob", () => {
  const cfg = { endpoint: "http://localhost:8787", org: "myorg", env: "dev", trigger: "render-video", secret: "s3cr3t" };

  it("maps a running job (not done, not failed)", async () => {
    const fn = stubFetch(200, { id: "thr_1", status: "running" });
    const res = await pollSynatraJob(cfg, "thr_1");
    expect(res).toMatchObject({ ok: true, status: "running", done: false, failed: false });
    expect((fn.mock.calls[0] as any)[0]).toBe("http://localhost:8787/api/threads/thr_1");
  });

  it("maps a completed job to done=true and carries the result", async () => {
    stubFetch(200, { status: "completed", result: { videoUrl: "https://x/y.mp4" } });
    const res = await pollSynatraJob(cfg, "thr_1");
    expect(res).toMatchObject({ ok: true, done: true, failed: false });
    expect(res.result).toEqual({ videoUrl: "https://x/y.mp4" });
  });

  it("maps a failed/cancelled job to failed=true", async () => {
    stubFetch(200, { status: "failed", error: "boom" });
    const res = await pollSynatraJob(cfg, "thr_1");
    expect(res).toMatchObject({ ok: true, failed: true, error: "boom" });
  });

  it("polls with the session COOKIE (not the webhook secret) when a session token is present", async () => {
    const fn = stubFetch(200, { status: "running" });
    await pollSynatraJob({ ...cfg, sessionToken: "sess-abc" }, "thr_1");
    const init = (fn.mock.calls[0] as unknown as [string, any])[1];
    expect(init.headers.Cookie).toBe("better-auth.session_token=sess-abc");
    expect(init.headers.Authorization).toBeUndefined();
  });
});

describe("synatra tools — surface + guards", () => {
  const tools = synatraTools();
  const run = tools.find((t) => t.name === "synatra_run")!;
  const status = tools.find((t) => t.name === "synatra_status")!;
  const ctx = { db: makeDb(), getWindow: () => null } as any;

  it("exposes synatra_run (confirm) and synatra_status (silent)", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(["synatra_run", "synatra_status"]);
    expect(run.safetyLevel).toBe("confirm");
    expect(run.confirmPrompt).toBeTypeOf("function");
    expect(status.safetyLevel).toBe("silent");
  });

  it("synatra_run rejects an empty prompt before any network call", async () => {
    const r = await run.execute({ prompt: "  " }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/prompt is required/i);
  });

  it("synatra_run refuses when Synatra is not enabled", async () => {
    const r = await run.execute({ prompt: "make a video" }, { db: makeDb({ providerEnabled: 0 }), getWindow: () => null } as any);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not enabled/i);
  });

  it("synatra_run submits and returns the threadId when configured", async () => {
    stubFetch(202, { threadId: "thr_42", status: "active" });
    const r = await run.execute({ prompt: "ocean waves", durationSec: 8 }, ctx);
    expect(r.ok).toBe(true);
    expect((r.data as any).threadId).toBe("thr_42");
  });

  it("synatra_status requires a threadId", async () => {
    const r = await status.execute({}, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/threadId is required/i);
  });
});
