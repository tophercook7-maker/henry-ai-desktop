# Henry AI Desktop — Replit Setup

## Overview

Henry AI is Topher's personal AI presence — a local-first AI OS with a dual-engine architecture (Local Brain / Ollama + Cloud Brain). He has warmth, memory, and a can-do philosophy: he always finds a way to help, never dead-ends a request.

Supports OpenAI, Anthropic, Google Gemini, and Ollama. 8 modes — all auto-detected from message content:
- **Companion** (chat) · **Writer** · **Developer** (code) · **Builder** (app builder) · **Biblical** (Ethiopian Orthodox aware) · **3D/Design** · **Secretary** (email, scheduling, tasks) · **Computer** (Mac automation)

### Features
- **Full web access** — auto-searches when needed; fetches any URL; supports Google CSE + Brave Search APIs
- **⌘K Command Palette** — fuzzy search across all modes, quick actions, recent conversations, navigation
- **Rich memory** — projects, goals, and people injected into Henry's system prompt (localStorage)
- **Contacts with interaction history** — log meetings/calls/emails; "Brief me" launches secretary chat
- **Builder mode live preview** — streaming partial HTML rendered live; viewport toggle; download HTML
- **Today panel** — quick-ask input at top, 8-mode launcher, morning briefing, recent conversations
- **Secretary panel** — daily briefing, email drafts, scheduling, task review, meeting prep
- **Voice input + TTS** — mic button (Web Speech API); 🔊 toggle reads Henry's responses aloud
- **Computer panel** — Mac shell/AppleScript/app control (Electron desktop build only)
- **3D Printer panel** — USB serial G-code terminal (Electron desktop build only)
- **Conversation auto-naming** — after the first exchange, Henry silently generates a 4-6 word title
- **Message copy button** — hover any message to copy it; code blocks get individual copy buttons
- **Message timestamps** — visible on hover, subtle and right-aligned
- **Syntax-highlighted code blocks** — highlight.js, language badge, one-click copy per block
- **Auto-updater** — electron-updater wired; banner in app notifies when update is ready

## Tech Stack

- **Framework:** React 18 + TypeScript
- **Build Tool:** Vite 5
- **Styling:** Tailwind CSS (dark theme)
- **State Management:** Zustand
- **AI SDKs:** OpenAI, Anthropic, Google Generative AI
- **Desktop:** Electron 31 + electron-builder 24 + electron-updater 6
- **Package Manager:** npm

## Project Structure

```
electron/         - Electron main process + IPC handlers
  main.ts         - App entry, auto-updater, IPC registration
  preload.ts      - Context bridge (window.henryAPI)
  ipc/            - ai, settings, database, memory, ollama, terminal, computer, printer
resources/
  icon.png        - 1024×1024 app icon (auto-converts to icns/ico by electron-builder)
  entitlements.mac.plist - Mac hardened runtime entitlements for notarization
src/
  App.tsx         - Root; setup/init logic; auto-update notification banner
  main.tsx        - React entry point (imports webMock)
  webMock.ts      - Browser-based mock for window.henryAPI (replaces Electron IPC)
  components/     - UI components organized by feature
    chat/
      ChatView.tsx        - Main chat UI; streaming, auto-naming, mode detection
      MessageBubble.tsx   - Message renderer; copy, timestamps, syntax-highlighted code
    today/
      TodayPanel.tsx      - Home screen; quick-ask input, mode cards, briefing
    settings/
      SettingsView.tsx    - Providers, Engines, General, Memory (Projects/Goals/People)
  henry/          - Core AI logic, scripture tools, workspace utilities
  store/          - Zustand global state
  global.d.ts     - CANONICAL type declarations for window.henryAPI
vite.web.config.ts  - Web-specific Vite config (no Electron plugins, port 5000)
vite.config.ts      - Original Electron Vite config (for desktop builds)
```

## Running the App

```
npm run dev        # Web preview on port 5000
npm run push       # Push to GitHub (requires GITHUB_PERSONAL_ACCESS_TOKEN)
```

## Mac DMG Build (on your Mac)

### Prerequisites
1. macOS with Xcode Command Line Tools
2. Node.js 20+ installed
3. Clone the repo and run:
```bash
npm install
npm run rebuild        # rebuild better-sqlite3 for Electron
```

### Build unsigned DMG (dev testing — no code signing required)
```bash
npm run build:mac:unsigned
```
Output: `release/Henry AI-*.dmg`

### Build signed + notarized DMG (for distribution)
1. Have an Apple Developer ID certificate in your Keychain
2. Set env vars:
```bash
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```
3. Run:
```bash
npm run build:mac
```

### Auto-updater (GitHub Releases)
- `electron-updater` is wired and checks GitHub for new releases 10 s after launch
- To publish a release with update artifacts:
```bash
GH_TOKEN=your_github_token npm run build:mac
```
- Then create a GitHub Release from the `release/` directory artifacts
- Future app installs will auto-download and show an in-app banner: "Henry update ready — restart to apply"

## Mobile & Cross-Platform

### Mobile (iPhone, iPad, Android) — Works Today via PWA
Visit the deployed Henry URL in Safari (iOS) or Chrome (Android) → tap Share → **Add to Home Screen**. Henry launches as a standalone app with the Henry icon, full-screen with no browser chrome.

**Mobile layout:**
- On `< 768px` screens: sidebar is hidden; a **bottom tab bar** appears with Today, Chat, Secretary, People, and a **More** drawer
- More drawer contains all remaining sections (Tasks, Files, Settings, etc.) + recent conversations
- All panels have responsive padding and grid layouts for small screens
- Chat input does not auto-focus on touch (prevents keyboard popping on load)
- Voice input (microphone) works on iOS Safari and Android Chrome

**What works on mobile:**
| Feature | iOS/Android |
|---|---|
| All 8 Henry modes | ✅ |
| Today, Chat, Secretary, Contacts | ✅ |
| Voice input | ✅ (Web Speech API) |
| Memory, projects, people | ✅ |
| Morning briefing | ✅ |
| OpenAI / Anthropic / Google AI | ✅ |
| Ollama local models | ❌ (runs on Mac only) |
| Terminal / Computer / File system | ❌ (desktop only) |

**Ollama from mobile:** Go to Settings → AI Providers → Ollama, set URL to `http://[Mac-IP]:11434`. Both devices will use the same Ollama instance on your Mac.

### Windows / Linux

**Electron desktop app** — builds with:
```bash
npm run build:win      # Windows NSIS installer (.exe)
npm run build:linux    # Linux AppImage
```
Run these on the target OS. All features work except Mac-specific automation (AppleScript).

**Web PWA on Windows/Linux** — opens in any browser, all cloud AI features work. Add to home screen (Chrome: three-dot menu → "Install Henry AI") for desktop app feel.

### iOS/Android Native App (Future)
Capacitor wraps the existing React app into a true App Store / Play Store app with zero rewrite. This unlocks:
- Push notifications
- Device calendar & contacts sync
- Offline-first with local storage
- App Store distribution

## Web Adaptation

The app uses `window.henryAPI` (Electron IPC bridge) everywhere. In web mode, `src/webMock.ts` provides a full browser-based implementation using `localStorage` and direct API fetch calls.

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
- Ollama requires CORS headers (`OLLAMA_ORIGINS=*`)

## Engine Configuration

### Two-Brain Architecture
- **Companion (Local Brain):** primary + fallback model slots. If primary fails mid-stream, fallback is tried automatically.
- **Worker (Cloud Brain):** for code/research tasks; runs async, injects result back into the active conversation.

### Conversation Auto-Naming
After the first assistant response in a new conversation, Henry fires a background non-blocking call to the same model with a simple prompt: "Create a 4-6 word title." The sidebar updates silently within a few seconds.

### Model Priority Order
- **Companion:** Llama 3.3 70B → Qwen 2.5 7B → Phi-4 → Mistral Nemo → Gemma 2 9B
- **Worker:** DeepSeek-R1 14B → DeepSeek-R1 7B → Qwen 2.5 72B → Llama 3.3 70B

## electron-builder Config Notes

- `"icon": "resources/icon.png"` at top level — electron-builder auto-converts to `.icns` on Mac, `.ico` on Windows
- `"hardenedRuntime": true` + entitlements file required for Mac notarization
- `"publish"` config points to GitHub for auto-updater
- `"identity": null` in `build:mac:unsigned` skips code signing for local dev builds

## Key Files

| File | Purpose |
|------|---------|
| `src/global.d.ts` | CANONICAL type declarations — edit this, not `src/types/globals.d.ts` |
| `src/webMock.ts` | Browser implementation of `window.henryAPI` |
| `electron/preload.ts` | Electron IPC bridge |
| `electron/main.ts` | Electron app entry + auto-updater |
| `src/henry/richMemory.ts` | Projects, goals, people storage |
| `resources/icon.png` | 1024×1024 app icon (programmatically generated) |
| `resources/entitlements.mac.plist` | Mac hardened runtime entitlements |
