# Henry AI Desktop — Finish Plan

This document captures the remaining work required to move the app from prototype → stable alpha.

## 🔴 Critical (must fix first)

### 1. Event listener leak
File: `src/App.tsx`
- Return cleanup from `useEffect`

### 2. Terminal safety
File: `electron/ipc/terminal.ts`
- Restrict commands OR introduce approval layer
- Enforce workspace-only cwd
- Block shell chaining (`;`, `&&`, `|`)

### 3. Sandbox
File: `electron/main.ts`
- Change `sandbox: false` → `true`

### 4. Task file operations
File: `electron/ipc/taskBroker.ts`
- Enforce workspace path safety (same logic as filesystem.ts)

---

## 🟠 Important

### 5. Strong typing
- Remove `any` in preload + renderer
- Use shared types (global.d.ts added in this branch)

### 6. Queue consistency
File: `taskBroker.ts`
- Default priority should match DB (5)

### 7. AI stream cancellation bug
File: `electron/ipc/ai.ts`
- `activeStreams` never set
- Add AbortController wiring

---

## 🟡 Next-level improvements

- SQLite FTS for memory
- Retry logic for API calls
- Cost tracking per task
- Basic test coverage (terminal + fs + queue)

---

## 🚀 Goal

Target state:
- Safe local-first AI desktop app
- Stable streaming + task queue
- No memory leaks
- No unsafe shell execution

---

## 💬 Notes

These changes require modifying existing files. This branch adds:
- Types (global.d.ts)
- CI (typecheck workflow)
- This plan

Next step: implement fixes directly in code.
