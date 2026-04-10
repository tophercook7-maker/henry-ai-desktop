# Henry AI Desktop — handoff notes (Replit / collaborators)

## What this repo is

- **Electron + React + Vite + TypeScript** desktop app.
- **SQLite** (`better-sqlite3`) and **IPC** in `electron/` — the renderer talks only through `preload.ts` → `window.henryAPI`.

Henry is intentionally **not** a generic chat wrapper: identity, lean memory, Biblical / Writer / Design3D modes, task bridge, export packs, and session recovery are first-class.

## Running locally (intended path)

```bash
npm install
npm run dev
```

Requires **Node 18+** and a desktop OS. The full app needs **Electron**; `henryAPI` is undefined in a plain browser tab.

## Smoke check (no installer)

```bash
npm run smoke
```

Runs TypeScript checks and a **Vite production build** (renderer + main + preload bundles). It does **not** run `electron-builder`.

## Replit / web-only constraints

- **Replit cannot replace Electron** for this project without a major fork. There is no separate HTTP backend; SQLite and AI calls live in the **main process**.
- A future Replit phase might add a **remote API** or **mock `henryAPI`** for UI demos — that would be **new architecture**, not what ships today.
- Safe enhancement targets on Replit: docs, design tokens, copy, or a **parallel** web prototype that does not delete IPC code paths.

## Preserved product pillars (do not regress)

- Henry voice: calm, wise, strong, direct (`src/henry/charter.ts` and related prompts).
- Lean memory (`src/henry/memoryContext.ts`, memory IPC).
- Biblical mode + **Ethiopian Orthodox canon** and **Ethiopian Study Bible** profiles (`src/henry/biblicalProfiles.ts`; default profile is Ethiopian canon awareness).
- Writer and Design3D modes, workspace context honesty (`src/henry/workspaceContext.ts`).
- Task ↔ workspace linkage, export packs (`src/henry/exportBundle.ts`, `exportManifest.ts`), session recovery (`src/henry/sessionResume.ts`).
- Command layer: `src/henry/commandLayer.ts`, `src/henry/commandActions.ts`, wired in `ChatView` (try `/help`).

## Known gaps / follow-ups

- **Installers**: `npm run build` runs `electron-builder` — needs platform tooling and signing for release.
- **Workspace path**: Settings → General → **Workspace hint** stores `workspace_path` for UI gates and prompts; filesystem sandbox remains under app userData (see `electron/main.ts`).
- **Automated E2E**: no Playwright/Cypress in repo; manual smoke on chat, tasks, files, scripture import, export pack, session restore after restart.

## Files to read first

| Area        | Location |
|------------|----------|
| IPC bridge | `electron/preload.ts`, `electron/main.ts` |
| AI stream  | `electron/ipc/ai.ts` |
| Chat       | `src/components/chat/ChatView.tsx` |
| Store      | `src/store/index.ts` |
| Henry logic| `src/henry/*.ts` |
