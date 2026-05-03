<div align="center">
  <h1>◉ Henry AI</h1>
  <p><strong>The cheapest, most capable personal AI on the market.</strong></p>
  <p>Local-first · Self-healing · Works on your Mac and phone · Costs almost nothing</p>
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

Henry is a personal AI that runs on your Mac. Not a chatbot — a full operating system layer.

- **Controls your Mac** — open apps, create folders, run commands, take screenshots
- **Works on your phone** — chat, voice commands, live Mac screen view from anywhere
- **Remembers you** — learns facts from conversations, uses them forever
- **Costs almost nothing** — 90% of tasks run free on Groq's API
- **Fixes itself** — diagnoses and repairs its own problems on every launch
- **No subscription** — your key, your data, your AI

## The Iron Gateway

Henry routes every request to the cheapest capable AI:

| What you say | How it's handled | Cost |
|---|---|---|
| "Hi", "thanks", time, math | Local — no API | **$0.00** |
| Simple questions, quick tasks | Groq 8b-instant | **$0.05/1M tokens** |
| Writing, analysis, Bible study | Groq 70b-versatile | **$0.59/1M tokens** |
| Image generation | DALL-E 3 (optional) | **$0.04/image** |
| Video generation | Runway Gen-4 (optional) | Pay per second |

Compare: GPT-4o costs $2.50/1M tokens. Henry is up to **50× cheaper**.

## Installation

### Mac (Recommended)

1. [Download the latest DMG](https://github.com/tophercook7-maker/henry-ai-desktop/releases/latest)
   - **Apple Silicon (M1/M2/M3/M4):** `Henry AI-x.x.x-arm64.dmg`
   - **Intel Mac:** `Henry AI-x.x.x.dmg`
2. Open the DMG → drag Henry AI to Applications
3. Open Henry AI → the onboarding wizard runs

### From Source

```bash
git clone https://github.com/tophercook7-maker/henry-ai-desktop.git
cd henry-ai-desktop
npm install
npm run dev
```

**Requirements:** Node.js 18+ · macOS 12+

## Setup (60 seconds)

1. **Get a free Groq API key** at [console.groq.com/keys](https://console.groq.com/keys) — free, no credit card
2. Open Henry AI → paste key in onboarding → done
3. Henry handles the rest (cloudflared installs itself, tunnel starts automatically)

## Features

### AI Chat
- Groq llama-3.3-70b-versatile — GPT-4 quality, free tier
- Streams responses in real time
- Multiple modes: biblical study, writing, business, focus
- Remembers facts across sessions

### Computer Control
From chat or computer panel:
```
"Create a folder called Work on my Desktop"
"Open Chrome and go to gmail.com"
"Take a screenshot"
"What apps are running?"
"Set volume to 50"
```

### Mobile Companion
Open `http://[your-mac-ip]:4242` on any phone or tablet:
- Full Henry chat with voice input
- Execute Mac commands remotely
- Live screen view (2.5s auto-refresh)
- Works anywhere via auto-started Cloudflare tunnel
- Auto-reconnects — persistent device identity

### 3D Model Generator
Print Studio → 🔧 3D Generator:
- Describe any object in plain English
- Drop a photo — Claude vision analyzes shape and dimensions
- Enter measurements in mm
- Download real STL or 3MF files — correct millimeter scale
- WebGL 3D preview before downloading
- Opens in PrusaSlicer, Bambu Studio, Cura, OrcaSlicer

### Everything Else
| Panel | What it does |
|---|---|
| Journal | Daily entries, mood, full-text search, auto-save |
| Tasks | Personal task manager (todo/doing/done), priority |
| Finance | Income/expense tracking by category, monthly summary |
| CRM | Contacts with notes, last-contact tracking |
| Lists | Emoji lists, checkboxes, progress bar |
| Secretary | AI email drafts, meeting briefs, summaries |
| Focus | Pomodoro timer with AI check-ins |
| Reminders | Native Mac notifications, repeating |
| Image Gen | DALL-E 3 (OpenAI key required) |
| Video Gen | Runway Gen-4 (Runway key required) |
| Health | Self-diagnosis, auto-repair, software audit |

### Self-Repair
Henry checks and fixes 12 things on every launch:
- cloudflared, ffmpeg, yt-dlp → auto-installs via brew
- Auto-tunnel disabled → enables automatically
- Screen Recording denied → opens System Settings to the right panel
- API key missing → tells you exactly where to add it

## Required

- **Groq API key** — [console.groq.com/keys](https://console.groq.com/keys) (free)
- macOS 12 Monterey or later
- Node.js 18+ (for building from source)

## Optional

- **Anthropic API key** — for Claude vision in 3D Generator photo analysis
- **OpenAI API key** — for DALL-E 3 image generation
- **Runway API key** — for Gen-4 video generation
- **Homebrew** — Henry auto-installs tools via brew if available

## Mobile Setup

1. Henry shows your local URL in the Companion panel (⊚)
2. Open that URL on your phone — connects automatically
3. For off-network access: enable "Auto-start tunnel" in Companion → Remote Access
4. The tunnel URL appears on your mobile when active — tap to copy

## Architecture

```
Electron (main process)
├── syncBridge.ts    — HTTP server :4242, mobile companion, SSE stream
├── selfRepair.ts    — Health checks, auto-fix
├── memory.ts        — SQLite IPC: tasks, finance, journal, contacts, lists, etc.
└── main.ts          — App lifecycle, auto-update, permissions

React (renderer)
├── henry/gateway.ts — Iron Gateway cost router
├── henry/memoryPipeline.ts — Fact extraction via Groq
└── components/      — All panels

SQLite DB: ~/Library/Application Support/henry-ai-desktop/henry-workspace/henry.db
```

## Cost Philosophy

Henry is designed to be the cheapest capable AI available:

1. **Local first** — greetings, math, time → $0 always
2. **Groq free tier** — 30 req/min, handles most users completely free
3. **8b model** — for simple chat, 50× cheaper than GPT-4
4. **70b model** — for quality tasks, still 4× cheaper than GPT-4
5. **Paid APIs** — only for things that literally require them (image/video gen)

The Today panel shows your daily cost and how much you saved vs GPT-4.

## Building for Distribution

```bash
# Apple Silicon + Intel
npm run build:mac:unsigned

# Output:
# release/Henry AI-x.x.x-arm64.dmg  (Apple Silicon)
# release/Henry AI-x.x.x.dmg        (Intel)
```

## Auto-Update

Henry checks GitHub Releases every 4 hours. When a new version is available, it downloads and installs on next app quit. No action required.

---

Built by [Topher Cook](https://github.com/tophercook7-maker) · MIT License
