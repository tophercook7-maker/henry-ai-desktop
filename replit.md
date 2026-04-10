# Henry AI Desktop — Replit Setup

## Overview

Henry AI is a local-first AI operating system with a dual-engine architecture (Companion + Worker engines). It supports multiple AI providers (OpenAI, Anthropic, Google Gemini, Ollama) and specialized modes for biblical study, writing, and 3D design planning.

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
