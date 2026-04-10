# Henry AI Desktop — Replit Setup

## Overview

Henry AI is Topher's personal AI presence — a local-first AI OS with a dual-engine architecture (Local Brain / Ollama + Second Brain / Cloud). He has warmth, memory, and a can-do philosophy: he always finds a way to help, never dead-ends a request.

Supports OpenAI, Anthropic, Google Gemini, and Ollama. 7 modes — all auto-detected from message content:
- **Companion** (chat) · **Writer** · **Developer** (code) · **Biblical** (Ethiopian Orthodox aware) · **3D/Design** · **Secretary** (email, scheduling, tasks) · **Computer** (Mac automation)

### Features
- **Today panel** — home screen with greeting, 7-mode launcher, recent conversations, quick asks
- **Secretary panel** — quick-action hub: daily briefing, email drafts, scheduling, task review, meeting prep, follow-ups
- **Contacts panel** — lightweight CRM stored locally; Henry uses contact context in conversation
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

## Deployment

Configured as a static site deployment:
- **Build:** `npm run build:web` (Vite build with web config)
- **Output:** `dist/`
- **Target:** Static hosting
