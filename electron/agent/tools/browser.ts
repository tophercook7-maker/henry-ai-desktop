/**
 * Browser automation tool — Henry's hands on the live web (design §1.6, beyond
 * the read-only `web_*` kit).
 *
 * `browser_task` drives the `browser-use` library through `browserBridge.ts`:
 * Henry hands it a plain-English web task ("book a 2pm slot on …", "fill in the
 * contact form at … with …", "find the cheapest …") and an autonomous agent
 * opens a real Chrome session, navigates, clicks, and types until the task is
 * done, then reports back.
 *
 * This is strictly more powerful than `web_fetch_page` (a single read), so it
 * is **confirm** tier — Henry always asks before letting an agent loose in a
 * browser on the user's behalf.
 *
 * The browser agent needs its own LLM. We reuse whatever provider key the user
 * already configured in Settings → AI Providers: Google/Gemini is preferred
 * (browser-use's strongest path), with Groq as a fallback. The key never leaves
 * the main process — it is read from the local `providers` table and passed to
 * the Python subprocess via env.
 */

import type Database from "better-sqlite3";
import type { ToolDefinition, ToolResult } from "../types";
import { runBrowserTask, browserBridgeAvailable, type BrowserProvider } from "../browserBridge";

function ok(data: unknown): ToolResult {
  return { ok: true, data };
}
function fail(error: string, retryable = false): ToolResult {
  return { ok: false, error, retryable };
}

interface ProviderRow {
  id: string;
  api_key: string;
}

/** Pick the browser agent's LLM provider from the user's configured keys.
 *  Google/Gemini first (best browser-use support), then Groq. */
function pickProvider(db: Database.Database): { provider: BrowserProvider; apiKey: string } | null {
  const rows = db
    .prepare(
      "SELECT id, api_key FROM providers WHERE id IN ('google','groq') AND enabled = 1 AND TRIM(api_key) != ''",
    )
    .all() as ProviderRow[];
  const byId = new Map(rows.map((r) => [r.id, r.api_key.trim()]));
  if (byId.has("google")) return { provider: "google", apiKey: byId.get("google")! };
  if (byId.has("groq")) return { provider: "groq", apiKey: byId.get("groq")! };
  return null;
}

export function browserTools(): ToolDefinition[] {
  return [
    {
      name: "browser_task",
      description:
        "Open a real web browser and autonomously complete a multi-step task on " +
        "the live web — navigating pages, clicking, and filling forms. Use this " +
        "(not web_search or web_fetch_page) when the goal needs interaction or " +
        "spans several pages: booking an appointment, submitting a form, looking " +
        "up an order's status behind a flow, comparing options across a site, or " +
        "gathering info that a single page fetch can't reach. Describe the goal " +
        "in plain language, including any specifics (dates, names, values) the " +
        "agent will need. Returns what the agent accomplished plus the pages it " +
        "visited. Slower than a plain fetch — prefer web_fetch_page for reading a " +
        "single known URL.",
      category: "automation",
      safetyLevel: "confirm",
      confirmPrompt: (p) =>
        `Let an automated browser agent carry out this web task: "${String(p.task ?? "").slice(0, 200)}"`,
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description:
              "The web task to accomplish, in plain language. Include all needed " +
              "specifics (URLs, dates, names, values). E.g. \"Go to acme.com/contact " +
              "and submit the form with name 'Pat', email 'pat@x.com', message 'Need a quote'.\"",
          },
          max_steps: {
            type: "number",
            description: "Maximum agent steps before giving up (default 12, max 30).",
          },
          headless: {
            type: "boolean",
            description:
              "Run without a visible window (default true). Set false to show the " +
              "browser so the user can watch.",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
      async execute(params, context): Promise<ToolResult> {
        const task = String(params.task ?? "").trim();
        if (!task) return fail("task is required");

        const avail = browserBridgeAvailable();
        if (!avail.ok) return fail(avail.reason ?? "browser-use is not installed.");

        const picked = pickProvider(context.db);
        if (!picked) {
          return fail(
            "The browser agent needs an AI provider. Add a Google (Gemini) or Groq " +
              "API key in Settings → AI Providers, then try again.",
          );
        }

        const rawSteps = Number(params.max_steps);
        const maxSteps = Number.isFinite(rawSteps) ? Math.min(30, Math.max(1, Math.round(rawSteps))) : 12;
        const headless = params.headless === false ? false : true;

        const res = await runBrowserTask({
          task,
          provider: picked.provider,
          apiKey: picked.apiKey,
          maxSteps,
          headless,
        });

        if (!res.ok) {
          // Browser/network/agent hiccups are worth one retry; config problems
          // (no key, not installed) are surfaced by the guards above.
          return fail(res.error ?? "Browser task failed.", true);
        }

        return ok({
          result: res.result,
          steps: res.steps ?? null,
          urlsVisited: res.urls ?? [],
          provider: res.provider,
          model: res.model,
        });
      },
    },
  ];
}
