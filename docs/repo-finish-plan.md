# Henry AI Desktop — Finish Plan

_Last reviewed: 2026-06-07 (v2.3.0). This replaces the April plan, whose
"critical blockers" were all resolved — keeping that list around was sending
people to fix already-fixed things._

## ✅ Resolved since the April plan (verified in code)

| Old item | Status | Where |
|---|---|---|
| Sandbox disabled (`sandbox:false`) | **Done** — `sandbox: true` | `electron/main.ts:64` |
| Terminal accepts any command | **Hardened** — shared classifier blocks catastrophic commands (rm -rf of roots, fork bomb, mkfs, dd, shutdown), inspecting chained segments | `electron/ipc/terminal.ts`, `electron/ipc/_commandSafety.ts` |
| Task file ops lack path safety | **Done** — shared `safeResolve` | `electron/ipc/taskBroker.ts`, `electron/ipc/_pathSafety.ts` |
| Filesystem sibling-dir traversal | **Fixed** — correct prefix check + symlink hardening | `electron/ipc/filesystem.ts`, `_pathSafety.ts` |
| `computer:notify` shell injection | **Fixed** — `execFileSync`, no shell | `electron/ipc/computer.ts` |
| AI stream cancellation never wired | **Done** — `activeStreams` set + cancel path | `electron/ipc/ai.ts:899,998` |
| Queue default priority mismatch | **Already consistent** — `task.priority ?? 5` == DB default 5 | `taskBroker.ts:161`, `database.ts:65` |
| Event-listener leak in App.tsx | **Largely addressed** — major effects return cleanups | `src/App.tsx` |
| No tests at all | **Started** — vitest + first suites (security + content blocks) | `electron/ipc/*.test.ts` |

---

## 🔴 Real remaining priorities

### 1. Expand test coverage outward from the security core
There are now tests for the path/command-safety helpers and content blocks. The
next highest-value targets, in order:
- **Session store** (`electron/python/session_store.py`) — search, migration,
  branch/resume. Drive the CLI from a vitest test or a small pytest.
- **AI streaming** (`electron/ipc/ai.ts`) — cancellation, error propagation.
- **Task queue** (`electron/ipc/taskBroker.ts`) — priority ordering, abort.
- **The agent tool runner** (`electron/agent/toolRunner.ts`) — the confirm-tier
  gate must be tested; it's the approval boundary for AI-initiated actions.

### 2. Security review of the agent action surface
The shell/file surfaces are hardened, but the *agent layer* is new and growing
(`electron/agent/tools/*`: email, calendar, messages, finance, web, quickbooks).
Each tool that sends data out or takes an irreversible action should:
- route through the confirm-tier gate (verify none bypass it), and
- validate/escape its own inputs (same discipline as `computer:notify`).
Worth a dedicated pass before these ship enabled by default.

### 3. Python dependency fallback for the session store
The session store needs Python 3.9+ on the user's machine. `session:checkDeps`
reports availability — make sure the renderer degrades gracefully (clear
"history unavailable" state) instead of erroring when Python is missing.

### 4. Finish or hide the half-built panels
Several panels are partial (CRM, finance, secretary, meeting recorder, deeper
companion features). Decide per-panel: finish, or gate behind a "beta" flag so
the shipped surface is all things that work. Prefer depth over new breadth.

---

## 🟡 Nice-to-haves
- Retry/backoff on API calls.
- Per-task cost tracking surfaced in the UI (the session store already tracks
  per-session tokens/cost).
- Coverage reporting (`@vitest/coverage-v8`) once the suite grows.

---

## 🧹 Housekeeping
- Duplicated CI workflows (`typecheck 2.yml`, `desktop-release 2.yml`, etc.) —
  consolidate to one each.
- Stray release folders (`release/`, `release2/`) — keep one, gitignore build
  output.

---

## 🚀 Definition of "shippable to general availability"
- All shell/file/agent actions gated or validated (✅ shell/file; agent layer in
  review — item 2).
- `npm test` green and covering the risky modules (in progress — item 1).
- No half-built panel reachable without a beta flag (item 4).
- Graceful degradation when optional deps (Python, API keys) are absent.
