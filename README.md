<div align="center">
  <h1>◉ Henry AI</h1>
  <p><strong>A personal AI that talks, codes, builds, and teaches — for almost nothing.</strong></p>
  <p>Local-first · Self-healing · Voice built in · Works on your Mac and phone</p>
  <br>
  <a href="https://github.com/tophercook7-maker/henry-ai-desktop/releases/latest">
    <img src="https://img.shields.io/github/v/release/tophercook7-maker/henry-ai-desktop?label=Download&color=6366f1" />
  </a>
  <img src="https://img.shields.io/badge/Platform-macOS-black" />
  <img src="https://img.shields.io/badge/AI-Groq%20Free%20Tier-22c55e" />
  <img src="https://img.shields.io/badge/License-MIT-white" />
</div>

---

## What Henry Is

Henry is a personal AI that runs on your Mac. Not a chatbot — a companion built around seven jobs:

1. **Talks, types, and listens** — free local voice, hands-free mode, spoken replies
2. **Writes code** — powered by the Claude Code CLI on your subscription, or a free local coder
3. **Writes books and designs the covers** — real KDP-ready specs, AI art, typography
4. **Connects to your machines** — 3D printers (Bambu, Klipper, OctoPrint, Marlin) and GRBL CNC
5. **Teaches you anything** — structured courses with lessons and quizzes, Bible study first-class
6. **Keeps you organized** — tasks, reminders, journal, goals, finance, memory that persists
7. **Runs your maker shop** — filament stock, production runs, waste, machine maintenance

All of it local-first: your key, your data, no subscription to Henry itself.

## Voice

Henry listens with **whisper.cpp** running on your Mac — free, offline, private. First tap of the mic runs a one-time setup (~150MB model, installed automatically). Replies speak through the built-in Mac voice, or through ElevenLabs automatically if you add a key.

- Tap the mic, talk, edit the transcript, send
- **Hands-free mode**: speak → Henry answers out loud
- Works in every mode — dictate a chapter, ask what your printer's doing

## Code

In Code mode, Henry hands work to the **Claude Code CLI** — your Claude subscription, huge context window, real file edits in a sandboxed workspace with approval gating. No CLI or offline? Henry falls back to a **free local coder** via Ollama (qwen2.5-coder). A chip in the chat picks: Auto / Claude Code / Local.

## Books & Covers

The Book panel captures your story into chapters — and now finishes the job with **Cover Studio**:

- Enter title, author, genre, page count → Henry computes your exact KDP specs (trim, bleed, spine width to the thousandth of an inch)
- **Do it for me**: AI cover art + genre-aware title typography, exported as ebook (1600×2560) and print-resolution PNGs, plus a print-specs sheet for the full wrap
- **Teach me**: a step-by-step guide tailored to your exact book, using free tools

## Machines

Add your printers and CNC in the Machines panel — Henry speaks their language:

| Machine | Protocol | Status |
|---|---|---|
| Bambu Lab (X1/P1/A1) | LAN MQTT | Live status, pause/resume/stop |
| Klipper (Voron, Prusa, modded Enders) | Moonraker | Full: upload, print, control |
| OctoPrint | REST API | Full: upload, print, control |
| Marlin (stock Enders) | USB serial | One-time setup: `npm i serialport && npm run rebuild` |
| GRBL CNC (Shapeoko etc.) | USB serial | Same one-time setup; jog, home, stream G-code |

Ask in chat: *"What's my printer doing?"* — Henry answers with live temps and progress. Pause/stop go through his approval gate.

Plus the full maker suite: filament/materials stock, production runs, waste log, maintenance history, Print Studio, slicer integration, and the 3D Model Generator (describe an object or drop a photo → real STL/3MF at correct millimeter scale).

## Lessons

Tell Henry what you want to learn — *"the book of James"*, *"biblical Greek basics"*, *"how MQTT works"* — pick a depth and length, and he builds a real course: lessons unlock in order, each with teaching, key scriptures (public-domain quoting), real-world application, and a quiz that unlocks the next lesson at 60%. Bible study is first-class; "Teach me anything" covers the rest.

## Organization

| Panel | What it does |
|---|---|
| Today | Daily briefing, cost tracker |
| Tasks | todo / doing / done, priorities |
| Journal | Daily entries, mood, full-text search |
| Reminders | Native Mac notifications, repeating |
| Goals + Weekly | Long-term goals, weekly review |
| Finance | Income/expense by category, monthly P&L |
| Captures | Voice/text notes with AI extraction |
| Memory | Henry learns facts from conversation, forever |
| Recorder | Meeting recording & transcription |

## Computer Control

From chat or the computer panel:

```
"Create a folder called Work on my Desktop"
"Open Chrome and go to gmail.com"
"Take a screenshot"  ·  "What apps are running?"  ·  "Set volume to 50"
```

## Mobile Companion

Open `http://[your-mac-ip]:4242` on any phone or tablet: full chat with voice input, remote Mac commands, live screen view. Works anywhere via the auto-started Cloudflare tunnel; devices pair once and reconnect automatically.

## The Iron Gateway

Every chat request routes to the cheapest capable AI:

| What you say | How it's handled | Cost |
|---|---|---|
| "Hi", "thanks", time, math | Local — no API | **$0.00** |
| Simple questions | Groq 8b-instant | **$0.05/1M tokens** |
| Writing, analysis, Bible study | Groq 70b-versatile | **$0.59/1M tokens** |
| Coding | Claude Code (your subscription) or local | **$0 marginal** |
| Voice in/out | whisper.cpp + Mac voice | **$0.00** |
| Image generation | DALL-E 3 (optional key) | $0.04/image |

## Self-Repair

Henry checks and fixes himself on every launch: cloudflared, ffmpeg, yt-dlp, whisper-cpp auto-install via brew; missing permissions open the right System Settings panel; missing keys tell you exactly where to add them.

## Installation

1. [Download the latest DMG](https://github.com/tophercook7-maker/henry-ai-desktop/releases/latest)
   - **Apple Silicon (M1–M4):** `Henry-AI-x.x.x-arm64.dmg`
   - **Intel Mac:** `Henry-AI-x.x.x.dmg`
2. Drag Henry AI to Applications, open it, follow the 60-second onboarding
3. Get a free Groq API key at [console.groq.com/keys](https://console.groq.com/keys) — no credit card

### From Source

```bash
git clone https://github.com/tophercook7-maker/henry-ai-desktop.git
cd henry-ai-desktop
npm install
npm run dev:electron
```

**Requirements:** macOS 12+ · Node.js 20+ (source builds)

## Optional

- **Claude Code CLI** — best-in-class coding on your Claude subscription (`npm i -g @anthropic-ai/claude-code`)
- **Ollama** — free local chat + coding fallback
- **Anthropic / OpenAI keys** — Claude vision for the 3D generator, DALL-E 3 for images and covers
- **ElevenLabs key** — premium speaking voice (local voice works without it)
- **serialport** (one-time `npm i serialport && npm run rebuild`) — USB Marlin printers and GRBL CNC

## Architecture

```
Electron (main process)
├── coder/        — Claude Code CLI runner + local Ollama fallback
├── machines/     — Bambu MQTT · Moonraker · OctoPrint · Marlin/GRBL serial
├── voice/        — whisper.cpp STT · say/ElevenLabs TTS
├── syncBridge.ts — mobile companion server :4242 + tunnel
├── selfRepair.ts — health checks, auto-fix
└── ipc/          — SQLite: tasks, journal, finance, memory, lessons, ...

React (renderer)
├── henry/gateway.ts    — Iron Gateway cost router
├── henry/coverSpecs.ts — KDP trim/spine/bleed math
└── components/         — all panels

SQLite: ~/Library/Application Support/henry-ai-desktop/henry-workspace/henry.db
```

## Building for Distribution

```bash
npm run build:mac        # signed arm64 + x64 DMGs → release2/
```

## Auto-Update

Henry checks GitHub Releases every 4 hours and installs updates on next quit. No action required.

---

Built by [Topher Cook](https://github.com/tophercook7-maker) · MIT License
