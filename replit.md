# Henry AI Desktop — Replit Setup

## Overview

Henry AI is Topher's personal AI presence — a local-first AI OS with a dual-engine architecture (Local Brain / Ollama + Cloud Brain). He has warmth, memory, and a can-do philosophy: he always finds a way to help, never dead-ends a request.

Supports OpenAI, Anthropic, Google Gemini, Groq, and Ollama. 11 built-in modes + unlimited custom modes:
- **Companion** (chat) · **Writer** · **Developer** (code) · **Builder** (app builder) · **Biblical** (Ethiopian Orthodox aware) · **3D/Design** · **Secretary** (email, scheduling, tasks) · **Computer** (Mac automation) · **Coach** · **Strategic** · **Business Builder**
- **Custom Modes** — create and save your own modes with name, icon, description, system prompt, and launch with one tap

### Features

**Connection Architecture** *(fully scaffolded)*
- **Central store** — `src/connections/store/connectionStore.ts` is the canonical Zustand store; `src/henry/connectionStore.ts` re-exports from it for backward compat
- **Selectors** — `src/connections/store/connectionSelectors.ts` exports `selectStatus`, `selectIsConnected`, `selectNeedsReconnect`, `selectGoogleProfile`, `selectAllConnections`
- **Types** — `src/connections/types/connectionTypes.ts` defines `ConnectionStatus`, `ServiceConnection`, `GoogleConnection`, `ConnectionRecord`, `ConnectionProvider`, `OnboardingConfig`, `HealthResult`
- **Provider files** — one per service: `googleConnection`, `slackConnection`, `githubConnection`, `notionConnection`, `linearConnection`, `stripeConnection` — each exports `getCapabilities()`, `checkHealth()`, `getOnboardingConfig()`
- **UI components** — `ConnectionStatusBadge`, `ReconnectBanner`, `ConnectionCard` in `src/connections/ui/`
- **Data layer** — 8 service data files in `src/integrations/*/`; each re-exports types and API functions from `henry/integrations.ts` and adds service-specific helpers (formatters, prompt builders, etc.)
- **Actions skeleton** — `src/actions/types/actionTypes.ts` + `src/actions/registry/actionRegistry.ts` with 15 planned actions; `getActions()`, `registerHandler()`, `runAction()` API
- **IntegrationsPanel.tsx** migrated — now reads from `useConnectionStore` with reactive `selectStatus` per card; removed `forceUpdate` hack; `ConnectModal` calls `connectService`/`disconnectService` through store

**Dev & Service Integrations** *(new — sidebar: Dev & Services section)*
- **Integrations hub** — `/integrations` panel showing all services; connect via paste-in token (GitHub, Linear, Notion, Stripe, Google Calendar, Gmail) or auto-connected via Replit OAuth (Slack)
- **GitHub panel** — repos list with search, issues (open/closed filter, create new issues), pull requests; uses GitHub REST API via `/proxy/github` with user-supplied PAT
- **Linear panel** — assigned issues grouped by team, priority filter (Urgent/High/All), links to Linear directly; uses Linear GraphQL API via `/proxy/linear`
- **Notion panel** — search and browse pages/databases; uses Notion API v1 via `/proxy/notion`
- **Slack panel** — channel list, message history, compose + send; connected via Replit OAuth connector (no manual token needed); uses `/connector/slack/*` → `@replit/connectors-sdk`
- **Service proxy routes** — all service calls go through the Vite dev server middleware (CORS-safe); proxy routes for GitHub, Linear, Notion, Stripe, Google Calendar, Gmail; Replit connector middleware for OAuth-managed services
- **Capability awareness** — `src/henry/capabilityContext.ts` reads live connection state per service and generates a dynamic natural-language capability block injected into every Companion system prompt; organizes into always-available thinking capabilities vs. active acting capabilities (per connected service) vs. locked-but-available capabilities; Henry now answers "what can you do" with accurate, specific, service-aware descriptions
- **Action Voice layer** — `src/actions/voice/actionVoice.ts` is the single source of truth for how Henry speaks at every action stage: suggest, confirm, start, success, error, reconnect-needed, not-connected; per-action definitions for all 25 actions with category-level fallbacks; all write-action handlers now import and use `actionSuccessMessage` / `actionErrorMessage` instead of raw API error strings; public API: `actionStartMessage`, `actionConfirmMessage`, `actionSuccessMessage`, `actionErrorMessage`, `actionSuggestMessage`, `actionReconnectMessage`, `actionNotConnectedMessage`
- **Decision Layer** — `src/actions/decision/actionDecision.ts` determines when Henry acts vs. confirms vs. blocks: `getActionDecision(id)` → `{ mode: 'act' | 'confirm' | 'block', message }` — reads registry `requiresConfirmation` + `readonly` + `isConnected(service)` live; exported helpers: `isReadOnly`, `requiresConfirmation`, `canRunNow`, `getBlockReason`, `getActionMode`, `getAllDecisions`, `getImmediateActions`, `getBlockedActions`
- **Action Behavior in system prompt** — `actionBehaviorBlock` in `charter.ts` teaches Henry's LLM voice: how to speak at each stage, what language to never use (API / token / endpoint / 401), the suggest/confirm/act/block decision model in natural language
- **Ambient Presence System** — Three-layer architecture on top of `wakeWordManager` (`src/henry/wakeWord.ts`): (1) `src/ambient/noteRouter.ts` — offline pattern-based classifier (8 categories: reminder/task/workspace_note/project_note/personal_memory/journal/chat_input/general_note) + routing execution to reminders.ts/chatBridgeStore/localStorage destinations; `autoRoute()` only fires for high-confidence patterns (reminder, chat_input); (2) `src/ambient/capturesStore.ts` — Zustand store with localStorage persistence (`henry:captures_v1`); listens to `henry_ambient_note` DOM events, classifies each note, auto-routes obvious ones; actions: `addCapture`, `reclassify`, `routeCapture`, `editCapture`, `archive`, `restore`, `clearArchived`, `clearAll`; (3) `src/components/ambient/CapturesPanel.tsx` — full review UI with category badges (clickable to reclassify), routing buttons (primary dest + expandable others), inline text editing, timestamps, archive/dismiss; TitleBar shows unrouted count badge (warning color) that navigates to captures view; `'captures'` added to ViewType; Captures nav item in Home group of sidebar; store initialized at app startup via `useCapturesStore.getState().init()`
- **Memory Recall** — `src/ambient/memoryRecall.ts` is the retrieval side of the routing system: `buildAmbientMemoryBlock()` reads all ambient localStorage buckets (memory/workspace/project/journal/tasks/saved) and generates a compact markdown context block injected into every system prompt in `charter.ts`; `getAmbientItems(dest, limit)` used by panels for UI display; `removeAmbientItem(dest, id)` for per-item deletion from any bucket; ambient notes now flow bidirectionally — captured by ambient listener → classified → routed → recalled in Henry's context
- **Panel surface integration** — Ambient captures surfaced across panels: (a) TodayPanel shows an "unrouted captures" warning widget (count + preview of first item + "Review →" link to CapturesPanel) whenever there are pending captures; (b) TaskQueueView has `AmbientTasksSection` below the main queue showing task-routed ambient items with "Add" (promotes to Henry chat) and dismiss actions; (c) WorkspaceView has `AmbientNotesSection` showing workspace + project routed notes with dismiss — all link back to CapturesPanel for full management
- **Recorder auto-select** — `MeetingRecorderPanel` now auto-selects the most recent recording on mount (previously the right panel was always blank until the user clicked a recording)
- **Initiative System** — `src/henry/initiativeStore.ts`: Zustand store with `mode: 'quiet' | 'balanced' | 'proactive'` persisted to `henry:initiative_mode`; `buildInitiativeModeBlock()` generates a system prompt block that tells Henry exactly how to behave at each level (quiet = respond only, balanced = mention when genuinely relevant, proactive = connect dots and surface context actively); mode selector in Settings → General → "Henry's initiative level" (3-column card picker)
- **Awareness System** — `src/henry/awarenessStore.ts`: `buildAwarenessBlock()` reads fresh from all data sources at system prompt build time — pending tasks (count + top 3 titles), upcoming/overdue reminders, active projects, unrouted capture count with preview, recent ambient notes, connected services, journal today status; generates a "What's going on right now" context block injected between ambient memory and continuity in every Companion prompt; Henry uses this naturally — references it when relevant, ignores it when not
- **Constitution / Operating Principles** — `src/henry/constitution.ts`: Static (no localStorage) — Henry's ranked conflict-resolution framework; 7 principles in rank order: (1) What Matters Most — meaningful > urgent; (2) Continuity Over Reset — carry threads forward, never drop context; (3) Calm Over Chaos — surface only what earns its place; (4) Action With Intention — act when it helps, not to appear useful; (5) Truth Over Appearance — honest about limits, never fake capability; (6) Respect the User's Values — align with stated standards; (7) Do Not Waste — nothing important should be lost; each principle has rank, title, description, whenToApply, overrides, exampleBehaviors; `buildConstitutionBlock()` generates compact ranked list injected between identity/self-description and memory blocks; `getPrincipleById(id)` utility for other systems to reference a specific principle; charter injection order: `identityModelBlock → selfDescriptionGuidance → constitutionBlock → conflictSignalsBlock → memoryBlock → ... → runtimeContextBlock → initiative`
- **Conflict Detector** — `src/henry/conflictDetector.ts`: Reads live localStorage at charter-build time to detect which of the 7 principles are actively relevant right now; per-principle detectors: P1 fires when high-weight commitments compete with urgent tasks, P2 fires when active continuity threads exist, P3 fires when focus session/quiet initiative/evening/overload, P4 fires on quiet initiative or many unrouted captures, P5 fires when services are disconnected, P6 fires when non-negotiable values are set, P7 fires on unrouted captures or stale high-weight commitments; `ConflictSnapshot` output: `signals[]` (active + watch), `dominant` (highest-rank active signal), `calmActive`, `mattersMostActive`, `doNotWasteActive` boolean shortcuts; `buildConflictSignalsBlock(snapshot)` emits only active signals (no watch noise) — injected into charter conditionally; used by priority engine to adjust score thresholds and category floors
- **Initiative Engine** — `src/core/initiative/initiativeEngine.ts`: Converts pre-computed brain state into a concrete "should I say something?" decision; reads from `getSharedBrainState()` — never re-scores; gates: (1) quiet initiative mode → silent, (2) build/reflection session mode → silent, (3) evening rhythm in non-proactive mode → silent; decision cascade: reconnect alerts first (always surface), then coordinator `surfaceNow` items (pre-suppressed), then proactive mode top focus (if score ≥ threshold), then proactive mode active thread; message builders for each case (urgent, focus, thread, connection); `hasAnythingToSurface()` lightweight pre-check; `evaluateInitiative()` returns `InitiativeSuggestion { shouldSurface, message, strength, sourceItem, reason }`; strength: direct (≥80) / clear (≥60) / gentle (≥40) / silent
- **Runtime Context** — `src/core/runtime/runtimeContext.ts`: Unified `RuntimeContext` object that represents "what is active right now" — built cheaply from pre-computed shared state; fields: topPriority + score + category, activeThread + type + nextStep, secondaryThreads[], focusItems (up to 3 urgent/important), blockedItems, suggestedNextMove, sessionMode, rhythmPhase, activePrinciples[], reconnectNeeded[], isReady, lastUpdated; `buildRuntimeContextBlock()` injects only thread nextStep + active principles + reconnect into charter — supplements coordinator block with what it doesn't cover
- **Brain Selectors** — `src/brain/brainSelectors.ts`: Named typed read-only accessors for shared brain state; exports: `selectTopItem()`, `selectTopThree()`, `selectSurfaceNow()`, `selectSuggestedSurfaceItem()`, `selectNeedsAttention()`, `selectUnresolvedCount()`, `selectPrimaryThread()`, `selectSecondaryThreads()`, `selectActiveThreadTitle()`, `selectLastRefreshedAt()`, `selectBackgroundRunning()`, `selectIsPriorityStale()`, `selectReconnectNeeded()`, `selectFocusSummary()`; reads through `getSharedBrainState()` — no direct Zustand in consumers; for thread queries delegates to threadSelectors, for priority queries delegates to prioritySelectors
- **Thread Selectors** — `src/henry/threads/threadSelectors.ts`: Named helpers for continuity thread state; `getPrimaryThread()` = highest-weight active thread; `getSecondaryThreads()` = up to 3 non-primary; `getThreadFocusCandidates()` = active + weight≥40 + unresolved items; `getUnresolvedThreads()`; `getOpenThreadCount()`
- **Workspace Focus Bar + Top 3 Widget** — `WorkspaceFocusBar` and `WorkspaceTop3` components in `WorkspaceView.tsx`; FocusBar reads `useSharedBrainState` and shows top focus (with urgent indicator), active thread, up-next item, and reconnect need in a compact bar — only renders after first background brain run; Top3 shows the priority snapshot's `top3` items as a numbered list with color-coded source badges (reminder/task=blue, commitment=yellow, relationship=purple, capture=green, project=orange, conversation=blue-teal) and urgency markers; Top3 sits above Quick actions in the workspace scroll area
- **Proactive Chat Surfacing** — `ChatView.tsx` now calls `hasAnythingToSurface()` + `evaluateInitiative()` via `useEffect` when the background brain has run (`priorityReadyAt` non-null) and the conversation is empty; 2.2s settle delay to let brain stabilize; once-per-session guard ref prevents re-firing; suggestion rendered as a small Henry notice bubble above the EmptyChat discovery grid; clears automatically when user sends first message
- **Relationship System** — `src/henry/relationshipStore.ts`: 9 types (`family/friend/work/collaborator/client/vendor/mentor/faith/recurring`); fields: id, name, type, notes, importance (1–10), lastInteraction (ISO), followUpNeeded, followUpNote, openLoops[], lifeArea, relatedCommitmentIds[]; CRUD: `addRelationship()`, `updateRelationship()`, `clearFollowUp()`, `markFollowUpNeeded()`, `touchRelationship()`, `deleteRelationship()`; `loadActiveRelationships()` = follow-up needed OR last contact within 7 days; `buildRelationshipBlock()` injects top 4 active people with type, follow-up note, last contact days, open loop count; storage key `henry:relationships:v1`; priority integration: importance≥6 + followUpNeeded → `relationship` source in priority engine (overdue > 7 days → `important_soon`); Weekly Review "People" section with `PersonCard` (Done/Follow up actions, inline follow-up note prompt), `AddPersonForm` (name + type + importance + optional follow-up note)
- **Standards/Values System** — `src/henry/valuesStore.ts`: 9 categories (`faith/family/work_ethic/integrity/stewardship/health/creative/pace/principle`); fields: id, title, description, category, importance (1–10), nonNegotiable, lifeArea, active; CRUD: `addValue()`, `updateValue()`, `deactivateValue()`, `toggleNonNegotiable()`; `loadValues()` sorts non-negotiables first then by importance; `buildValuesBlock()` injects top 5 active values as a lens for Henry's priority weighting and alignment reasoning — only fires when user has set at least one value; storage key `henry:values:v1`; Weekly Review "Your values" section with `ValueItem` (★ non-negotiable toggle, × remove) and `AddValueForm` (title + category + importance + non-neg toggle)
- **Identity/Self-Model System** — `src/henry/identityModel.ts`: Static (no localStorage) — Henry's own self-understanding; `HENRY_IDENTITY` constant defines roles (companion/organizer/continuity keeper/thinking partner/steady operator), purpose (5 statements about what Henry is for), promises (7 steady commitments — "nothing wasted," "drop no important thread," "never pretend capabilities"), standards (10 behavioral anchors — calm, useful, clear, grounded, trustworthy, honest, non-dramatic, action-capable, memory-aware, context-sensitive), boundaries (6 firm edges), recoveryPrinciples (5 rules for how Henry responds when wrong or limited); `buildIdentityModelBlock()` generates compact charter block injected after `aiDisclaimerBlock`; `buildSelfDescriptionGuidance(connectedServices)` generates guidance for how Henry should answer "who are you?" questions — names real capabilities + connected services, sounds like himself not a product; charter injection order: `identityModelBlock → selfDescriptionGuidance → memoryBlock → valuesBlock → ...`
- **Commitment System** — `src/henry/commitmentStore.ts`: Durable, intentionally-set obligations distinct from auto-extracted working memory; 5 types (`personal/project/relational/recurring/henry`) × 6 statuses (`open/active/waiting/blocked/resolved/dropped`); fields: id, title, description, type, status, lifeArea (auto-inferred), relatedThreadId, dueAt, weight (1–10), blockedReason, createdAt, lastTouchedAt, resolvedAt; CRUD: `addCommitment()` (auto-infers life area from title), `updateCommitmentStatus()`, `resolveCommitment()`, `dropCommitment()`, `touchCommitment()`, `updateCommitment()`; `buildCommitmentsBlock()` injects max 5 open items into charter with type + status suffix + overdue flag — calm, steady language ("carry these honestly without force"); storage key `henry:commitments:v1` added to backgroundBrain storage triggers; Weekly Review "Open commitments" section with `CommitmentCard` (Done/Wait/Drop actions, overdue/due-soon highlighting, description + blockedReason display) and `AddCommitmentForm` (title + type selector + low/medium/high weight picker, "Hold it" submit); section position: after Active Threads, before Open Loops
- **Session Mode System** — `src/henry/sessionModeStore.ts`: 6 states (`auto/build/admin/reflection/capture/execution`) persisted to `henry:session_mode`; `inferSessionMode()` reads primary thread type + unrouted capture count + rhythm phase to auto-select mode; `buildSessionModeBlock()` generates a behavioral directive block tailored to each mode (build = structure/momentum/suppress tangents; admin = quick wins/concise; reflection = calm/spacious/no urgency; capture = fast intake/brief responses; execution = top priority/push to completion; auto-inferred mode appends a note); injected into every charter as `sessionModeBlock` between continuityBlock and initiativeBlock; Settings → General → "Session mode" 6-button card picker matching initiative/priority design pattern
- **Daily Rhythm System** — `src/henry/dailyRhythm.ts`: 6 phases (`morning_setup/focus_block/admin_window/meeting_prep/evening_review/weekly_reset`) inferred purely from local time-of-day and day-of-week — no storage; Monday 5–10am → weekly reset; 5–9am → morning setup; 9am–noon → focus block; noon–2pm → admin window; 2–6pm → focus block; 6–9pm → evening review; `buildRhythmBlock()` generates a time-appropriate context directive injected into charter after awarenessBlock; `getRhythmState()` returns current phase + label + description for UI use; `inferRhythmPhase()` passed to session mode inference as a signal
- **Life Areas / Domains System** — `src/henry/lifeAreas.ts`: 8 life areas (`business/faith/health/family/money/creative/admin/growth`); `inferLifeArea(text)` keyword-scores text against per-area keyword lists to guess domain; `computeDomainDistribution()` aggregates across active threads + tasks + captures + working memory items to compute a percentage breakdown by domain; `buildLifeAreaBlock()` injected into charter only when a dominant domain (>45% concentration) is detected — outputs a 1–2 line directive to weight that domain's context more heavily
- **Weekly Review Panel** — `src/components/weekly/WeeklyReviewPanel.tsx`: new `weekly` ViewType, nav item "Weekly" in Home group; panel sections: current rhythm phase + session mode badges; active threads (from threadStore, with type/next step/open items + "Done" button); open loops (unresolved working memory questions/commitments/concerns); upcoming pressure (reminders due within 48h or overdue); recent captures (last 5, with routed indicator); life areas distribution (horizontal bar chart, with "quiet this week" callout for neglected areas); quick navigation buttons to Today/Tasks/Reminders/Captures/Workspace/Journal
- **Continuity Thread Manager** — `src/henry/threads/` (2 files): `threadStore.ts` — types (`ContinuityThread`: id/title/type/status/weight/lastTouched/suggestedNextStep/unresolvedItems/relatedProjectId/source) + CRUD (`loadActiveThreads`, `upsertDerivedThread`, `pauseThread`, `resolveThread`, `activateThread`) + `buildContinuityThreadBlock()` — generates primary thread block (type label + next step + open items) + secondary thread names; `threadEngine.ts` — `deriveAndSaveThreads()` reads HenryProject, WorkingMemoryItem, Task from localStorage and creates: (a) project threads for each active project (weight 60 + recency + WM links), (b) conversation threads from grouped working memory by conversationId when 2+ unresolved items, (c) task threads for running/high-priority orphaned tasks; merges with store preserving user-controlled status; background brain integration: `jobRefreshThreads()` added to `runAllJobs()` alongside priority/awareness/connection jobs; coordinator integration: `loadActiveThreads()` called in `runCoordinator()` to set `activeThread` (primary title) + `secondaryThreads[]` (secondary titles) in shared state; `buildCoordinatorBlock()` now embeds `buildContinuityThreadBlock()` instead of plain `Active thread: "X"` string — Henry now sees thread type, next step, open items, and other arcs in motion
- **Dual-Brain Orchestration** — `src/brain/` (4 files): `sharedState.ts` — Zustand store holding pre-computed brain output: priority snapshot, awareness snapshot, connection health, coordinator output (`surfaceNow[]`, `topFocus`, `keepQuiet[]`, `connectionAlerts[]`, `activeThread`, `unresolvedCount`), background run metadata; `backgroundBrain.ts` — event-driven job runner started at app boot via `startBackgroundBrain()` in App.tsx, triggers on DOM events (`henry_ambient_note`, workspace/writer context changes), `storage` events for key Henry localStorage keys, light 5-minute poll fallback; jobs: `jobRefreshPriority()` + `jobRefreshAwareness()` + `jobCheckConnectionHealth()` — all run in `Promise.allSettled()` then call `runCoordinator()`; debounced (800ms) to prevent rapid-trigger thrashing; `coordinator.ts` — reads from shared state, applies suppression (localStorage-persisted 20-min cooldown per item, sessionStorage-persisted per-session connection alerts), applies initiative-mode-aware surface threshold (proactive=40, balanced=60, quiet=99), writes `surfaceNow`/`keepQuiet`/`connectionAlerts`/`topFocus` back to shared state, `buildCoordinatorBlock()` generates system prompt block; `awarenessAdapter.ts` — lightweight adapter exposing `buildSnapshot()` without circular imports; Charter wiring: coordinator block replaces priority block when background brain is ready (pre-computed, filtered), falls back to fresh priority block computation on first conversation before brain has run
- **Priority Engine** — `src/henry/priority/` (4 files): `priorityTypes.ts` — all types: `PriorityCategory` (urgent_now / important_soon / active_focus / background / parked / resolved), `PrioritySource`, `PrioritySignals`, `PriorityItem`, `PrioritySnapshot`, `PriorityMode` (calm / balanced / urgency); `prioritySources.ts` — reads from all 7 data stores (reminders, tasks, projects, captures, ambient notes, computer snapshot, connected services) and converts each item into a `PriorityItem` with raw signals populated; `priorityEngine.ts` — scores every item 0–100 using a weighted signal model (overdue +40, due-within-1h +30, explicit-urgent +25, blocking-other +18, mention-count up to +20, active-project +12, unresolved +8, recency up to +10, connected/computer context +5–6), applies mode multipliers (urgency ×1.5 on time signals, calm ×0.6/0.5), assigns categories, builds the full `PrioritySnapshot` with `topFocus`, `top3`, `surfaceNow`, `keepQuiet` buckets; `prioritySelectors.ts` — 30s-cached snapshot accessor, named selectors (`getTopFocus`, `getTop3`, `getSurfaceNow`, `getKeepQuiet`), `buildPriorityBlock()` generates a "Henry's current priority picture" system prompt block injected into every Companion prompt; user-selectable priority focus mode in Settings → General → "Priority focus mode" (Calm focus / Balanced / Urgency first)
- **Computer Awareness + Snapshot System** — `src/henry/computerSnapshotStore.ts`: Zustand store with `takeSnapshot()` that runs IPC calls to collect machine info (platform, hostname, OS version, RAM), running apps, active focused app (via AppleScript), recent Downloads files, and permissions (accessibility + screen recording); stores as `henry:computer_snapshot` (valid 1 hour); `buildComputerSnapshotBlock()` injects the snapshot into every system prompt when a recent one exists; `ComputerPanel` now opens on the new **📍 Snapshot** tab (default), auto-runs a snapshot on mount, shows Machine/Active app/Open apps/Recent Downloads/Permissions cards with a "Refresh snapshot" button
- **Proposed integrations** — Linear, Slack (connected), Notion, Jira, Stripe, Google Calendar, Gmail all proposed for user to connect

**Core AI**
- **Groq hardwired** — Groq is set as the permanent default engine; 8B Instant (fast) + 70B Versatile (quality) auto-routed by `modelRouter.ts`
- **Maximum memory** — `HENRY_MEMORY_CAPS` tuned for 128K context: 50 facts, 12K summary, 40 history turns, 8K chars/message
- **maxTokens wired** — 16,384 tokens for biblical/quality tasks, 8,192 for fast tasks; passed to every stream call
- **Full web access** — `webTools.ts` tool layer: `search_web`, `open_url`, `extract_page_text`, `summarize_page`, `collect_sources`; auto-detects web intent before LLM call; injects live context into system prompt; shows source citations as clickable pills
- **Bible Corpus** — `bibleCorpus.ts`: downloads full KJV (~31K verses) from CDN, stores in IndexedDB; `getBibleContextForPrompt()` injects up to 100K chars of scripture into biblical mode context; "Load Full Bible" button with live download progress
- **⌘K Command Palette** — fuzzy search across all modes, quick actions, recent conversations, navigation
- **Rich memory** — projects, goals, and people injected into Henry's system prompt (localStorage)

**7-Layer Memory Architecture** *(Memory Blueprint — fully implemented)*
- **Layer 1** — Live Turn: current message + tool results (ChatView)
- **Layer 2** — Session Memory: DB-backed per-conversation state (`session_memory` table); `sessionLifecycle.ts` manages start/tick/end/compression; `session_end` summaries + `where_we_left_off` auto-generated
- **Layer 3** — Working Memory: DB-backed single-row state (`working_memory` table); localStorage fast cache + DB sync; commitments table for Henry's explicit promises
- **Layer 4** — Personal Memory: `personal_memory` table with 5-dimensional scoring (relevance, recency, emotional, strategic, confidence); 12 memory types (identity, preference, habit, value, frustration, goal, etc.); auto-ingested from user messages; `scoreMemoryFact()` ranks facts by combined score
- **Layer 5** — Project Memory: `projects` + `project_memory` tables; tracks status, summary, blockers, deadlines, strategic/emotional importance
- **Layer 6** — Relationship Memory: `relationship_memory` table; tracks support style patterns, overwhelm responses, communication preferences; confidence-gated updates
- **Layer 7** — Narrative Memory: `narrative_memory` table; life/work arcs with linked projects and memories; slow-changing, importance-scored
- **Memory Graph**: `memory_graph_edges` table — links projects↔files↔conversations↔commitments↔milestones↔arcs
- **Memory Summaries**: `memory_summaries` table — daily/weekly/monthly rollups, project rollups, session-end summaries, where-we-left-off
- **Bandwidth Modes**: shallow (fast/minimal) → normal (session+working+personal) → deep (+projects+relationship+narrative) → maximum (all layers + milestones + where-we-left-off + timeline)
- **Scoring formula**: `retrieval_score = (relevance×0.30) + (recency×0.20) + (emotional×0.15) + (strategic×0.25) + (confidence×0.10)` — used in `memoryRetrieval.ts` + `workingMemory.ts`
- **Key files**: `electron/ipc/database.ts` (12-table schema), `electron/ipc/memory.ts` (full CRUD + deep context builder), `src/henry/memoryRetrieval.ts` (client scoring + formatter), `src/henry/sessionLifecycle.ts` (lifecycle + personal memory ingestion), `src/henry/workingMemory.ts` (Layer 3 cache + narrative)

**Life Architecture**
- **Emotion Detection** — `emotionDetector.ts`: detects 9 emotional states (overwhelmed, stressed, urgent, scattered, excited, confused, discouraged, confident, focused); `buildEmotionBlock()` injected into every enriched system prompt
- **State Indicator Bar** — shows Thinking…/Planning…/Acting…/Responding…/Done ✓ with 1.5s flash; planning (spinner) + acting (dots) states added
- **Presence Phrases** — spoken via browser TTS before quality tasks; wired in `ambientBrain.ts`
- **Voice input (Groq Whisper)** — mic button → MediaRecorder → Groq Whisper STT → inserts transcript into chat
- **Document ingestion** — drag-and-drop or attach files in chat input; Henry gives multi-angle perspective
- **Status indicators** — live state bar shows Thinking…(8B/70B) → Responding… → Done with 1.5s checkmark; presence phrases spoken via browser TTS before heavy tasks

**Three New Modes**
- **Coach mode** — executive coaching approach: one focused question at a time, reflects back, challenges excuses, accountability focus, ends each session with one clear next action
- **Strategic mode** — senior advisor thinking: outcomes-first, leverage points, tradeoffs, 2-3 options, scenario planning, structured output with clear recommendations
- **Business Builder mode** — idea → offer → customer avatar → revenue model → launch plan → first customer pipeline; bias toward action and revenue

**Chat Quick Actions**
- **Message action chips** — hover any Henry response to see "Summarize", "→ Tasks", "Shorter", "Simpler" buttons; clicking any fires a follow-up prompt automatically; wired into the main handleSend flow

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
