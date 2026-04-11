# Henry AI Desktop — Replit Setup

## Overview

Henry AI is Topher's personal AI presence — a local-first AI OS with a dual-engine architecture (Local Brain / Ollama + Cloud Brain). He has warmth, memory, and a can-do philosophy: he always finds a way to help, never dead-ends a request.

Supports OpenAI, Anthropic, Google Gemini, Groq, and Ollama. 8 built-in modes + unlimited custom modes:
- **Companion** (chat) · **Writer** · **Developer** (code) · **Builder** (app builder) · **Biblical** (Ethiopian Orthodox aware) · **3D/Design** · **Secretary** (email, scheduling, tasks) · **Computer** (Mac automation)
- **Custom Modes** — create and save your own modes with name, icon, description, system prompt, and launch with one tap

### Features

**Core AI**
- **Groq hardwired** — Groq is set as the permanent default engine; model: `llama-3.3-70b-versatile`
- **Full web access** — auto-searches when needed; fetches any URL; supports Google CSE + Brave Search APIs
- **⌘K Command Palette** — fuzzy search across all modes, quick actions, recent conversations, navigation
- **Rich memory** — projects, goals, and people injected into Henry's system prompt (localStorage)
- **Voice input (Groq Whisper)** — mic button → MediaRecorder → Groq Whisper STT → inserts transcript into chat
- **Document ingestion** — drag-and-drop or attach files in chat input; Henry gives multi-angle perspective

**Personal Assistant**
- **Reminders panel** — timed reminders with browser notifications, categories (personal/work/household/health/maker), repeat options; enabled by notification permission prompt
- **Lists panel** — grocery, hardware, household, ideas lists + custom lists with icon picker; check off items; copy full list
- **Today panel** — quick-ask input, 8-mode launcher, auto-generates morning briefing on first launch each day
- **Proactive nudges** — context-aware nudge banners (morning briefing, evening journal, stale tasks, project inactivity)
- **Clipboard AI** — detects clipboard content on focus; offers summarize/explain/improve/bullet/reply actions inline

**Business / Secretary**
- **Secretary panel** — daily briefing, email drafts, scheduling, task review, meeting prep
- **CRM panel** — clients with status (prospect/active/paused/closed), projects with pipeline, interaction log, "Brief me before meeting" button launches Henry in secretary mode with full client context
- **Finance panel** — income/expense tracker, monthly summaries (net P&L), category breakdown, CSV export, "Ask Henry to analyze" this month
- **Contacts panel** — contacts with interaction history; "Brief me" launches secretary chat

**Maker / 3D**
- **Print Studio panel** — 3 tabs: Gallery (print job log with material/settings/success), Filament tracker (spools with remaining % bar, color hex, brand), BOM (bill of materials grouped by project with status tracking)
- **Image Gen panel** — DALL-E 3 via OpenAI; size/style options; generated image gallery with download and reuse; requires OpenAI API key
- **3D Printer panel** — USB serial G-code terminal (Electron desktop build only)
- **3D/Design mode** — comprehensive slicer knowledge: material guide (PLA/PETG/ABS/ASA/TPU/Nylon/Resin), settings by use-case, failure diagnosis, Bambu/PrusaSlicer/Cura specifics, design-to-print pipeline, photo-to-3D workflows, OpenSCAD + Blender Python generation

**Dev Tools**
- **Builder mode live preview** — streaming partial HTML rendered live; viewport toggle; download HTML
- **Terminal panel** — shell access (desktop), AI-driven command suggestions
- **Computer panel** — Mac shell/AppleScript/app control (Electron desktop build only)
- **Workspace panel** — file workspace with context injection

**UX / Quality**
- **Journal panel** — date-stamped entries with Henry reflection on demand; sidebar search
- **Focus timer panel** — Pomodoro timer with AI check-ins
- **Meeting Recorder panel** — record → Groq Whisper → AI summary + action items → save tasks
- **Modes panel** — custom mode editor (icon, name, description, system prompt)
- **Conversation auto-naming** — 4-6 word title generated after first exchange
- **Message copy + code blocks** — hover to copy; syntax-highlighted code with language badge
- **Message timestamps** — visible on hover
- **Auto-updater** — electron-updater wired; banner notifies when update ready
- **Custom mode system prompt** — `henry_custom_mode_override` in localStorage overrides charter
- **Sidebar grouped navigation** — Home / Business / Maker / Tools sections for all 22 views

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

### iOS/Android Native App (Capacitor — Ready to build)
Capacitor wraps the existing React app into a true App Store / Play Store app with zero rewrite.

**First-time native project setup (run on your Mac):**
```bash
npx cap add ios      # creates ios/ Xcode project
npx cap add android  # creates android/ Android Studio project
```

**Every build thereafter:**
```bash
npm run cap:build    # builds web assets + syncs to native
npm run cap:ios      # opens Xcode → Archive → App Store
npm run cap:android  # opens Android Studio → Build → AAB
```

**Mobile proxy (required for AI calls on native):**
iOS/Android apps don't have a local server, so AI API calls need a proxy:
1. Deploy `proxy/worker.js` to Cloudflare Workers (free, ~2 min — see `proxy/README.md`)
2. In Henry on mobile: Settings → AI Providers → Mobile Proxy URL → paste worker URL

**Best free AI for mobile:**
| Provider    | Free tier               | Setup |
|-------------|------------------------|-------|
| Groq        | Llama 3.3 70B, Mistral | groq.com → free API key |
| Google Gemini | Gemini Flash          | aistudio.google.com → free key |
| OpenRouter  | 50+ free models        | openrouter.ai → free key |
| Ollama (Mac)| Unlimited, local       | Point mobile to Mac IP in settings |

### Desktop CI/CD (GitHub Actions)
Push a version tag and all three desktop builds run automatically:
```bash
git tag v1.0.0 && git push origin v1.0.0
```
GitHub Actions builds Mac DMG, Windows NSIS installer, and Linux AppImage + deb — artifacts attached to the GitHub Release automatically. See `.github/workflows/desktop-release.yml`.

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
