# 🧠 Henry AI Desktop

**Local-first AI operating system with dual-engine architecture.**

Henry AI runs on your machine, connects to the AI providers you choose, and keeps your data entirely local. It features a unique dual-engine architecture: a **Companion** that's always available for conversation, and a **Worker** that handles heavy tasks in the background.

## ✨ Features

- **Dual-Engine Architecture** — Companion (always-on chat) + Worker (background tasks)
- **Multi-Provider AI** — OpenAI, Anthropic, Google AI, or local models via Ollama
- **Transparent Pricing** — See per-model costs before you choose
- **Local-First** — All data stored on your machine in SQLite
- **Beautiful Dark UI** — Professional, focused, distraction-free
- **Setup Wizard** — Guided configuration with clear pricing for every option

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ 
- npm or yarn

### Install & Run

```bash
# Clone the repo
git clone https://github.com/tophercook7-maker/henry-ai-desktop.git
cd henry-ai-desktop

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Build Installers

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

## 🏗️ Architecture

```
┌──────────────────────────────────────────┐
│              HENRY AI                     │
├──────────────────────────────────────────┤
│                                           │
│  ┌─────────────┐   ┌──────────────────┐ │
│  │  COMPANION   │◄─►│     WORKER       │ │
│  │  Always On   │   │  Heavy Lifting   │ │
│  │  Fast Model  │   │  Powerful Model  │ │
│  └──────┬──────┘   └────────┬─────────┘ │
│         └──────────┬────────┘            │
│         ┌──────────┴──────────┐          │
│         │    TASK QUEUE       │          │
│         └──────────┬──────────┘          │
│         ┌──────────┴──────────┐          │
│         │   LOCAL STORAGE     │          │
│         │  SQLite + Files     │          │
│         └─────────────────────┘          │
└──────────────────────────────────────────┘
```

### Tech Stack

- **Framework**: Electron + React + TypeScript
- **Build**: Vite + electron-builder
- **Styling**: Tailwind CSS
- **State**: Zustand
- **Database**: SQLite (better-sqlite3)
- **AI SDKs**: OpenAI, Anthropic, Google AI, Ollama

## 📁 Project Structure

```
henry-ai-desktop/
├── electron/              # Electron main process
│   ├── main.ts           # App entry, window management
│   ├── preload.ts        # Secure IPC bridge
│   └── ipc/              # IPC handlers
│       ├── ai.ts         # AI provider communication
│       ├── database.ts   # SQLite initialization
│       ├── filesystem.ts # File system operations
│       └── settings.ts   # Settings & data management
├── src/                   # React frontend
│   ├── App.tsx           # Root component
│   ├── main.tsx          # Entry point
│   ├── components/
│   │   ├── chat/         # Chat interface
│   │   ├── layout/       # Sidebar, title bar
│   │   ├── queue/        # Task queue view
│   │   ├── settings/     # Settings panel
│   │   └── wizard/       # Setup wizard
│   ├── providers/        # AI model definitions & pricing
│   ├── store/            # Zustand state management
│   ├── styles/           # Global styles
│   └── types/            # TypeScript types
├── resources/            # App icons
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## 🔌 Supported AI Providers

| Provider | Models | Pricing |
|----------|--------|---------|
| **OpenAI** | GPT-4o, GPT-4o Mini, o1, o1 Mini | $0.15 - $60/M tokens |
| **Anthropic** | Claude Sonnet 4, Haiku 3.5, Opus 4 | $0.25 - $75/M tokens |
| **Google AI** | Gemini 2.0 Flash, 1.5 Pro, 1.5 Flash | $0.075 - $5/M tokens |
| **Ollama** | Llama 3.1, CodeLlama, Mistral | **Free** (local) |

## 🎯 Roadmap

### Phase 1 ✅ Foundation
- [x] Electron + React + TypeScript scaffold
- [x] Setup wizard with provider selection
- [x] Chat interface with streaming
- [x] Dual-engine selector
- [x] SQLite local storage
- [x] Multi-provider AI support

### Phase 2 🔄 Intelligence
- [ ] Full dual-engine with task queue
- [ ] File system browser & code editor
- [ ] Workspace management
- [ ] Conversation memory & context

### Phase 3 📋 Power
- [ ] Ollama local model integration
- [ ] Terminal execution
- [ ] Document generation with versioning
- [ ] Cross-platform installers
- [ ] Cost tracking dashboard

## 📄 License

MIT

---

*Henry AI — Your machine. Your data. Your AI.*
