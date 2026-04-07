# Henry AI Desktop — Replit Agent Guide

## What this app is
Henry AI is a local-first desktop AI operating system built with Electron + React. It combines chat, coding assistance, workflows, file access, and multi-provider AI into a single application.

## Current architecture
- Electron main process: `electron/main.ts`
- Preload bridge: `electron/preload.ts`
- IPC layer: `electron/ipc/*`
- UI: React + Vite in `src/`
- State: Zustand
- Database: SQLite via `better-sqlite3`
- Build system: Vite + electron-builder

## Product intent
This is not just a desktop chat app. It is intended to become:
- a full AI operating system
- multi-engine (Companion + Worker)
- multi-provider (OpenAI, Anthropic, Google, Ollama)
- capable of executing tasks, managing files, and orchestrating workflows

## What Replit Agent should optimize for
1. Preserve the dual-engine architecture (Companion vs Worker).
2. Do not collapse everything into a single chat loop.
3. Maintain IPC boundaries between renderer and main process.
4. Keep local-first philosophy — do not force cloud dependencies.
5. Avoid breaking Electron build or packaging configuration.
6. Keep security model (contextBridge, no direct Node access in renderer).
7. Prefer incremental improvements instead of large rewrites.

## Important realities
- This project is already well-structured but not fully production-hardened.
- It is more complex than a typical web app due to Electron + IPC.
- Replit cannot fully replicate native desktop packaging; focus on dev-mode functionality first.

## Build and run
- install: `npm install`
- dev: `npm run dev`
- build: `npm run build`

## High-priority finish plan
1. Ensure dev mode runs reliably in Replit (renderer + Electron process).
2. Validate IPC routes in `electron/ipc/*` are all wired correctly.
3. Verify database initialization and migrations.
4. Ensure setup wizard fully configures providers and persists settings.
5. Validate task queue (Worker engine) lifecycle.
6. Add clear error handling for provider failures.
7. Improve logging and debugging visibility.
8. Document all required API keys and configuration.

## Required configuration (likely)
- OpenAI API key
- Anthropic API key
- Google AI API key
- Ollama base URL (optional local)

These should be configurable through the app UI or environment variables — never hardcoded.

## Replit-specific expectations
- Focus on getting the app running in development mode (not installer builds).
- If Electron fails to run in Replit, create a fallback web-only dev mode for testing UI and logic.
- Do not remove Electron — only create fallbacks if needed.

## Coding preferences
- Maintain TypeScript correctness.
- Keep IPC handlers separated by concern.
- Do not merge unrelated modules.
- Avoid introducing global state outside Zustand.
- Keep renderer clean and focused on UI.

## Definition of done for a milestone
- app boots without crashes
- setup wizard completes successfully
- at least one AI provider works end-to-end
- task queue executes and returns results
- file system access works safely
- README clearly documents setup and limitations
