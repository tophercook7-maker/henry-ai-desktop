/**
 * Synatra stub server — a zero-dependency fake of the two Synatra HTTP endpoints
 * Henry's `synatraBridge` talks to, so the `synatra_run` / `synatra_status`
 * tools can be exercised end-to-end WITHOUT standing up the real
 * Postgres/Redis/Temporal stack.
 *
 * It fakes:
 *   POST /api/webhook/:org/:env/:trigger   → 202 { threadId, status:'active' }
 *   GET  /api/threads/:id                  → { status, result, error }
 *
 * Jobs progress over time: a thread reports `running` for RUN_MS, then flips to
 * `completed` with a fake video result — so polling actually transitions.
 *
 * Auth: requires `Authorization: Bearer <STUB_SECRET>` on both routes, mirroring
 * the real webhook secret check.
 *
 * Usage:
 *   node scripts/synatra-stub.mjs                 # port 8787, secret "dev-secret"
 *   PORT=9999 STUB_SECRET=xyz RUN_MS=3000 node scripts/synatra-stub.mjs
 */

import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.STUB_SECRET || "dev-secret";
const RUN_MS = Number(process.env.RUN_MS || 6000); // how long a job "runs" before completing

/** threadId → { createdAt, payload } */
const threads = new Map();

let counter = 0;
function nextThreadId() {
  counter += 1;
  return `thr_stub_${counter}_${Date.now().toString(36)}`;
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function authOk(req) {
  const h = req.headers["authorization"] || "";
  return h === `Bearer ${SECRET}`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve(null); // signal malformed JSON
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ['api','webhook','org','dev','render-video']

  // ── POST /api/webhook/:org/:env/:trigger ──────────────────────────────────
  if (req.method === "POST" && parts[0] === "api" && parts[1] === "webhook" && parts.length === 5) {
    if (!authOk(req)) return send(res, 401, { error: "unauthorized" });
    const payload = await readBody(req);
    if (payload === null) return send(res, 400, { error: "invalid JSON body" });
    if (!payload.prompt) return send(res, 422, { error: "payload failed schema: prompt is required" });

    const threadId = nextThreadId();
    threads.set(threadId, { createdAt: Date.now(), payload });
    console.log(`[stub] webhook ${parts[2]}/${parts[3]}/${parts[4]} → ${threadId}  prompt="${String(payload.prompt).slice(0, 60)}"`);
    return send(res, 202, { threadId, status: "active" });
  }

  // ── GET /api/threads/:id ──────────────────────────────────────────────────
  if (req.method === "GET" && parts[0] === "api" && parts[1] === "threads" && parts.length === 3) {
    if (!authOk(req)) return send(res, 401, { error: "unauthorized" });
    const id = parts[2];
    const t = threads.get(id);
    if (!t) return send(res, 404, { error: `no such thread: ${id}` });

    const elapsed = Date.now() - t.createdAt;
    if (elapsed < RUN_MS) {
      console.log(`[stub] poll ${id} → running (${elapsed}ms)`);
      return send(res, 200, { id, status: "running", result: null, error: null });
    }
    const out = t.payload.outputName || "render.mp4";
    console.log(`[stub] poll ${id} → completed`);
    return send(res, 200, {
      id,
      status: "completed",
      result: {
        videoUrl: `https://stub.local/videos/${id}/${encodeURIComponent(out)}`,
        durationSec: t.payload.durationSec ?? 10,
        prompt: t.payload.prompt,
      },
      error: null,
    });
  }

  // ── health ────────────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/") {
    return send(res, 200, { ok: true, service: "synatra-stub", threads: threads.size });
  }

  send(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
});

server.listen(PORT, () => {
  console.log(`[stub] Synatra stub listening on http://localhost:${PORT}  (secret="${SECRET}", RUN_MS=${RUN_MS})`);
});
