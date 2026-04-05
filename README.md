# 🧠 Henry AI Desktop

Your personal AI operating system — local-first, multi-provider, dual-engine.

**Henry AI** is an installable desktop application that combines the best of ChatGPT (reasoning), Cursor (code generation), and Viktor (structured workflows) into a single, privacy-first tool that runs on your machine.

## ✨ Features

### Dual-Engine Architecture
- **🧠 Companion** — Always-on, fast, conversational. Handles chat, quick answers, and workflow management.
- **⚡ Worker** — Powerful, focused. Handles code generation, research, file operations, and heavy tasks through a managed task queue.

### Multi-Provider AI
- **OpenAI** — GPT-4o, GPT-4o Mini, o1, o3-mini
- **Anthropic** — Claude Sonnet 4, Claude Haiku, Opus
- **Google** — Gemini 2.5 Pro, Flash, Ultra
- **Ollama** — Run local models free (Llama 3.1, Codestral, Mistral, etc.)
- Transparent per-token pricing with cost tracking

### Full Desktop Experience
- 📁 **File Browser** — Navigate, view, and edit workspace files
- 💻 **Terminal** — Execute shell commands with safety guards
- 🗂️ **Workspace** — 5-folder business structure (Product, Business, Marketing, Operations, Meetings)
- 📋 **Task Queue** — Submit, track, cancel, and retry Worker tasks
- 💰 **Cost Dashboard** — Monitor spending across providers and engines
- 🧠 **Memory** — Facts, summaries, and context that persist across conversations

### Setup Wizard
Guided 4-step setup with model selection, transparent pricing, and cost estimation before you spend a cent.

## 🚀 Quick Start

```bash
git clone https://github.com/tophercook7-maker/henry-ai-desktop.git
cd henry-ai-desktop
npm install
npm run dev
```

**Requirements:**
- Node.js 18+
- macOS, Windows, or Linux

**For local models:**
- Install [Ollama](https://ollama.ai)
- Pull a model: `ollama pull llama3.1:70b`

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
