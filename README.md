# Henry AI (Desktop)

Henry is a **local-first AI operating system** built with **Electron**, **React**, and **TypeScript**.

## What Henry does

- Companion AI
- Biblical study system (Ethiopian Orthodox aware)
- Writer / document system
- Design3D / STL / 3MF planning assistant
- Memory-aware assistant
- Workspace-aware operator
- Task + export bundle system

Chat **slash commands** (`/help`, `/mode`, `/new`, `/export-pack`, etc.) live in `src/henry/commandLayer.ts` and `src/henry/commandActions.ts`.

## Run locally

```bash
npm install
npm run dev
```

**First time from git:** clone the repo, then the same commands.

**Requirements:** Node.js 18+ · macOS, Windows, or Linux

**Dual engines:** **Companion** (chat + modes above) and **Worker** (task queue). **Providers:** OpenAI, Anthropic, Google, Ollama — configure in the setup wizard and Settings.

**Local models:** install [Ollama](https://ollama.ai), e.g. `ollama pull llama3.1:70b`

**Desktop shell:** file browser, terminal, workspace folders, task queue, cost dashboard, setup wizard.

## 🏗️ Architecture

```
┌──────────────────────────────────────────────┐
│                  React UI                      │
│  Chat │ Tasks │ Files │ Workspace │ Terminal   │
├──────────────────────────────────────────────┤
│              Zustand Store                     │
├──────────────────────────────────────────────┤
│          contextBridge (preload.ts)            │
├──────────────────────────────────────────────┤
│            Electron Main Process               │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Companion │  │  Worker   │  │ Task Broker│  │
│  │  Engine   │←→│  Engine   │←→│   Queue    │  │
│  └──────────┘  └──────────┘  └────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │  Memory   │  │  Ollama  │  │  Terminal   │  │
│  │  System   │  │  Local   │  │  Executor   │  │
│  └──────────┘  └──────────┘  └────────────┘  │
├──────────────────────────────────────────────┤
│  SQLite DB  │  Local Filesystem  │  Ollama    │
└──────────────────────────────────────────────┘
```

## 🔧 Tech Stack

- **Framework:** Electron + React + TypeScript
- **Build:** Vite + electron-builder
- **Styling:** Tailwind CSS (dark theme)
- **State:** Zustand
- **Database:** better-sqlite3
- **AI SDKs:** OpenAI, Anthropic, Google AI, Ollama (REST)

## ✅ Smoke test (CI-friendly)

```bash
npm run smoke   # typecheck + vite build (no electron-pack)
```

## 🤝 Handoff / Replit

See **[REPLIT.md](./REPLIT.md)** for collaborator notes, constraints, and what not to break.

## 📦 Building Installers

```bash
npm run build
npx electron-builder --mac     # macOS .dmg (arm64 + x64)
npx electron-builder --win     # Windows .exe (NSIS)
npx electron-builder --linux   # Linux .AppImage + .deb
```

## 📂 Project Structure

```
henry-ai-desktop/
├── electron/
│   ├── main.ts              # App lifecycle, window management
│   ├── preload.ts           # Secure IPC bridge
│   └── ipc/
│       ├── ai.ts            # Multi-provider AI with streaming
│       ├── database.ts      # SQLite schema & init
│       ├── filesystem.ts    # Workspace file operations
│       ├── memory.ts        # Facts, summaries, context builder
│       ├── ollama.ts        # Local model management
│       ├── settings.ts      # CRUD for all settings
│       ├── taskBroker.ts    # Task queue & Worker execution
│       └── terminal.ts      # Shell command execution
├── src/
│   ├── App.tsx              # Init, routing, event wiring
│   ├── store/index.ts       # Zustand global state
│   ├── types/               # TypeScript types
│   ├── providers/models.ts  # All models with pricing
│   ├── henry/               # Modes, memory, commands, export, session, scripture
│   └── components/
│       ├── chat/            # Chat UI, streaming, engine selector
│       ├── costs/           # Cost tracking dashboard
│       ├── files/           # File browser + code editor
│       ├── layout/          # Shell, sidebar, title bar
│       ├── queue/           # Task queue management
│       ├── settings/        # Provider & engine settings
│       ├── terminal/        # Built-in terminal
│       ├── wizard/          # 4-step setup wizard
│       └── workspace/       # 5-folder workspace manager
├── electron-builder.config.js
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## 📜 License

MIT
