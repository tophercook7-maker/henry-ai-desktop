/**
 * Synatra tools — Henry hands a background video-generation job to Synatra
 * (an AI-agent workspace on Temporal) and watches it run.
 *
 *   - `synatra_run`    — submit a job. confirm tier: it kicks off real,
 *                        possibly-billable background work on the user's behalf.
 *   - `synatra_status` — poll a previously-submitted job. silent tier (a read).
 *
 * Both go through `synatraBridge.ts`, which talks to Synatra's HTTP API. Video
 * renders take minutes, so `synatra_run` returns as soon as the job is accepted
 * (with a `threadId`); the model then polls `synatra_status` — or, later, the
 * taskBroker will poll durably and report completion back into chat (see the
 * integration plan, Phase 2 "Long-running jobs").
 */

import type { ToolDefinition, ToolResult } from "../types";
import {
  synatraAvailable,
  resolveSynatraConfig,
  submitSynatraJob,
  pollSynatraJob,
  type SynatraJobPayload,
} from "../synatraBridge";

function ok(data: unknown): ToolResult {
  return { ok: true, data };
}
function fail(error: string, retryable = false): ToolResult {
  return { ok: false, error, retryable };
}

export function synatraTools(): ToolDefinition[] {
  return [
    // ── synatra_run ──────────────────────────────────────────────────────────
    {
      name: "synatra_run",
      description:
        "Submit a background VIDEO-GENERATION job to Synatra and get back a job " +
        "id (threadId) to track it. Use this when the user wants a video made — " +
        "describe the video in plain language. The job runs in the background and " +
        "can take several minutes; this returns immediately once accepted. Poll " +
        "its progress with synatra_status using the returned threadId. Requires " +
        "Synatra to be configured in Settings.",
      category: "external",
      safetyLevel: "confirm",
      confirmPrompt: (p) =>
        `Submit a video-generation job to Synatra: "${String(p.prompt ?? "").slice(0, 200)}"`,
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "What the video should be, in plain language. Include the subject, " +
              "action, and any style cues. E.g. \"A 10-second cinematic clip of a " +
              "red sports car driving along a coastal road at sunset.\"",
          },
          durationSec: {
            type: "number",
            description: "Desired length in seconds (default 10).",
          },
          style: {
            type: "string",
            description: "Optional style/look, e.g. 'cinematic', 'anime', 'claymation'.",
          },
          outputName: {
            type: "string",
            description: "Optional friendly name for the resulting file.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      async execute(params, context): Promise<ToolResult> {
        const prompt = String(params.prompt ?? "").trim();
        if (!prompt) return fail("prompt is required");

        const avail = synatraAvailable(context.db);
        if (!avail.ok) return fail(avail.reason ?? "Synatra is not configured.");

        const resolved = resolveSynatraConfig(context.db);
        if (!resolved.ok) return fail(resolved.reason);

        const rawDuration = Number(params.durationSec);
        const payload: SynatraJobPayload = {
          prompt,
          durationSec: Number.isFinite(rawDuration) ? Math.min(120, Math.max(1, Math.round(rawDuration))) : 10,
          style: params.style ? String(params.style) : undefined,
          outputName: params.outputName ? String(params.outputName) : undefined,
        };

        const res = await submitSynatraJob(resolved.config, payload);
        if (!res.ok) {
          // Network/service hiccups are worth a retry; the guards above already
          // caught the deterministic config problems. But this is a confirm-tier
          // tool, so the runner will NOT auto-retry — surface as non-retryable to
          // avoid implying a silent re-submit will happen.
          return fail(res.error ?? "Synatra job submission failed.");
        }

        return ok({
          threadId: res.threadId,
          status: res.status ?? "active",
          message:
            "Video job submitted to Synatra. It runs in the background — check on it " +
            `with synatra_status (threadId: ${res.threadId}).`,
        });
      },
    },

    // ── synatra_status ───────────────────────────────────────────────────────
    {
      name: "synatra_status",
      description:
        "Check the status and result of a Synatra job previously started with " +
        "synatra_run. Pass the threadId you got back. Returns the current status " +
        "(running / completed / failed / …) and, when finished, the result.",
      category: "external",
      safetyLevel: "silent",
      inputSchema: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "The threadId returned by synatra_run.",
          },
        },
        required: ["threadId"],
        additionalProperties: false,
      },
      async execute(params, context): Promise<ToolResult> {
        const threadId = String(params.threadId ?? "").trim();
        if (!threadId) return fail("threadId is required");

        const resolved = resolveSynatraConfig(context.db);
        if (!resolved.ok) return fail(resolved.reason);

        const res = await pollSynatraJob(resolved.config, threadId);
        if (!res.ok) return fail(res.error ?? "Could not fetch Synatra job status.", true);

        return ok({
          threadId: res.threadId,
          status: res.status,
          done: res.done,
          failed: res.failed,
          result: res.result ?? null,
          error: res.error ?? null,
        });
      },
    },
  ];
}
