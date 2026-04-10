# Henry AI Desktop — Replit Setup

## Overview

Henry AI is Topher's personal AI presence — a local-first AI OS with a dual-engine architecture (Local Brain / Ollama + Second Brain / Cloud). He has warmth, memory, and a can-do philosophy: he always finds a way to help, never dead-ends a request.

Supports OpenAI, Anthropic, Google Gemini, and Ollama. 8 modes — all auto-detected from message content:
- **Companion** (chat) · **Writer** · **Developer** (code) · **Builder** (app builder) · **Biblical** (Ethiopian Orthodox aware) · **3D/Design** · **Secretary** (email, scheduling, tasks) · **Computer** (Mac automation)

### Features
- **Full web access** — auto-searches when needed (keywords like "latest", "today", "price of"), fetches any URL (via r.jina.ai), supports Google CSE + Brave Search APIs (Settings → General → Web Search)
- **⌘K Command Palette** — fuzzy search across all modes, quick actions, recent conversations, navigation. Press ⌘K or Ctrl+K anywhere
- **Rich memory** — structured projects, goals, and people injected into Henry's system prompt (`henry:rich_memory:projects`, `henry:rich_memory:goals`, `henry:rich_memory:people` in localStorage)
- **Contacts with interaction history** — log meetings/calls/emails per contact; "Brief me" button launches Henry secretary chat
- **Builder mode live preview** — streaming partial HTML rendered live as Henry generates the app; viewport toggle (mobile/tablet/desktop); download HTML
- **Builder diff-awareness** — every iteration starts with one sentence describing what changed
- **Today panel** — home screen with greeting, 8-mode launcher, recent conversations, quick asks
- **Secretary panel** — quick-action hub: daily briefing, email drafts, scheduling, task review, meeting prep, follow-ups
- **Voice input** — mic button in chat (Web Speech API, Chrome/Edge); speaks into the input
- **Text-to-speech** — 🔊 toggle in chat bar; Henry reads his responses aloud with markdown stripped
- **Computer panel** — Mac shell/AppleScript/app control (Electron desktop build only)
- **3D Printer panel** — USB serial G-code terminal (Electron desktop build only)
- **Memory panel** — Henry's known facts about Topher, editable in chat
- **Mode auto-detection** — every keyword-driven mode switch including secretary and computer phrases

Originally built as an Electron desktop app, it runs in Replit as a React web app with a browser-based mock layer replacing the Electron IPC bridge.

## Tech Stack

- **Framework:** React 18 + TypeScript
- **Build Tool:** Vite 5
- **Styling:** Tailwind CSS (dark theme)
- **State Management:** Zustand
- **AI SDKs:** OpenAI, Anthropic, Google Generative AI
- **Package Manager:** npm

## Project Structure

```
electron/         - Original Electron main process (not used in web mode)
src/
  App.tsx         - Root component with setup/init logic
  main.tsx        - React entry point (imports webMock)
  webMock.ts      - Browser-based mock for window.henryAPI (replaces Electron IPC)
  components/     - UI components organized by feature
  henry/          - Core AI logic, scripture tools, workspace utilities
  store/          - Zustand global state
  types/          - TypeScript interfaces
vite.web.config.ts  - Web-specific Vite config (no Electron plugins, port 5000)
vite.config.ts      - Original Electron Vite config (kept for desktop builds)
```

## Running the App

The app runs via the **Start application** workflow using:
```
npm run dev
```
This starts Vite on `0.0.0.0:5000` using `vite.web.config.ts`.

## Web Adaptation

The original app uses `window.henryAPI` (Electron IPC bridge) for all backend operations. In web mode, `src/webMock.ts` provides a full browser-based implementation using `localStorage` for persistence and direct fetch calls to AI provider APIs.

### Supported in Web Mode:
- Settings, conversations, messages (localStorage)
- AI providers: OpenAI, Anthropic, Google Gemini, Ollama (direct API calls)
- Streaming responses from all providers
- Tasks, memory facts, conversation summaries (localStorage)
- Scripture store (localStorage)
- Virtual file system (localStorage)

### Limitations in Web Mode:
- Terminal execution (disabled — shows friendly message)
- File picker for scripture import (disabled — returns canceled)
- Ollama requires CORS headers on the local Ollama instance

## Engine Configuration

### Two-Brain Architecture
- **Companion (Local Brain):** primary + fallback model slots (`companion_model` / `companion_model_2`). If the primary model fails during streaming, the fallback is tried automatically before showing an error.
- **Worker (Second Brain):** for code/research tasks; runs async, injects result back into the active conversation via `worker:message` IPC event.

### Startup Auto-Detect
On first load (when no model is configured), Henry auto-queries Ollama and picks the best installed models for Companion, Companion Fallback, and Worker using `autoSelectModels()` from `src/henry/modelPriority.ts`. Silent best-effort — no error if Ollama is unreachable.

### Model Priority Order
- **Companion:** Llama 3.3 70B → Qwen 2.5 7B → Phi-4 → Mistral Nemo → Gemma 2 9B
- **Worker:** DeepSeek-R1 14B → DeepSeek-R1 7B → Qwen 2.5 72B → Llama 3.3 70B

## Computer Control + 3D Printer (Desktop Only)

All wiring is in place for the Electron build:
- `electron/ipc/computer.ts` — screenshot, shell, AppleScript, app launcher, mouse/keyboard
- `electron/ipc/printer.ts` — pyserial bridge, serial port discovery, G-code terminal, print job streaming
- `electron/preload.ts` — exposes all APIs including `onWorkerMessage` for two-brain sync
- Web stubs in `webMock.ts` show friendly "requires desktop app" messages

## Deployment

Configured as a static site deployment:
- **Build:** `npm run build:web` (Vite build with web config)
- **Output:** `dist/`
- **Target:** Static hosting
