/**
 * Henry AI — Model Router
 * Routes each task to the right provider/model based on task type and quality preference.
 * Single source of truth for all model selection logic.
 */

export type TaskType =
  | 'chat_fast'      // short replies, acks, UI, light planning, ambient flow
  | 'chat_balanced'  // normal conversational chat
  | 'chat_quality'   // long summaries, planning, writing, strategy, reasoning
  | 'stt'            // speech-to-text (Groq Whisper)
  | 'tts';           // text-to-speech

export type QualityPreference = 'fast' | 'balanced' | 'quality';

export interface ModelRoute {
  provider: string;
  model: string;
  apiKey: string;
}

export interface STTRoute {
  model: string;
  apiKey: string;
}

export interface TTSRoute {
  provider: 'groq' | 'browser' | 'off';
  model: string;
  voice: string;
  apiKey: string;
}

// ── Task detection patterns ────────────────────────────────────────────────────

/** Patterns that always route to the quality (70B) model. */
const QUALITY_PATTERNS = [
  // Long summaries
  /\b(summarize|summarise|summary)\b.{20,}/i,
  /\blong.{0,10}(summary|overview|breakdown)/i,
  // Writing and rewriting
  /\b(write|draft|rewrite|revise|edit|compose|create)\b.{10,}(essay|report|proposal|document|email|letter|plan|outline|script|article|post|brief|memo|summary)/i,
  /\b(rewrite|reword|rephrase|improve|polish|refine)\b/i,
  // Multi-step planning
  /\b(roadmap|strategy|plan|blueprint|framework|phases?|milestones?)\b/i,
  /\bstep.by.step\b/i,
  /\bhow (do|should|would|can) (i|we|you).{5,}\?/i,
  // Business strategy
  /\b(business (plan|strategy|model|case)|go.to.market|competitive analysis|market research|swot|okr|kpi)\b/i,
  // Reasoning and analysis
  /\b(analyze|analyse|explain|compare|evaluate|assess|review|critique|break down|walk me through)\b.{10,}/i,
  /\b(pros and cons|trade.?offs?|decision|recommend|advise)\b/i,
  // Code tasks
  /```[\s\S]{50,}/,
  /\b(function|class|module|component|api|interface|schema)\b.{20,}/i,
  /\b(debug|fix|refactor|optimize|implement|build)\b.{15,}/i,
  // Long input
];

/** Patterns that always route to fast (8B) model. */
const FAST_PATTERNS = [
  // Acknowledgments
  /^(ok|okay|got it|sure|yes|yeah|no|nope|thanks|thank you|cool|great|perfect|sounds good|alright|noted|yep|k|i see|interesting|right|understood|makes sense)\.?$/i,
  // Single-word / very short
  /^.{1,30}$/,
  // UI interactions
  /^(go back|next|previous|skip|cancel|stop|help|show me|open|close|toggle|switch|more|less)[\s\S]{0,20}$/i,
  // Quick questions
  /^(what('?s| is) (the |your |my )?\w+\??|who('?s| is) \w+\??|when ('?s| is) \w+\??|where ('?s| is) \w+\??)$/i,
  // Quick summaries (short request)
  /^(tldr|tl;dr|summarize this|give me the gist|brief me|what('?s| is) this about)[\s\S]{0,30}$/i,
];

/**
 * Detect task complexity from message content.
 * Returns the appropriate tier for balanced mode routing.
 */
export function detectTaskType(content: string): 'chat_fast' | 'chat_balanced' | 'chat_quality' {
  const trimmed = content.trim();
  const len = trimmed.length;

  // Very short messages → always fast
  if (len < 50) return 'chat_fast';

  // Check fast patterns first
  for (const p of FAST_PATTERNS) {
    if (p.test(trimmed)) return 'chat_fast';
  }

  // Check quality patterns
  for (const p of QUALITY_PATTERNS) {
    if (p.test(trimmed)) return 'chat_quality';
  }

  // Length-based fallback
  if (len > 400) return 'chat_quality';
  if (len < 120) return 'chat_fast';

  return 'chat_balanced';
}

/**
 * Returns true if this message should use the deeper model (70B).
 * Used by ChatView to decide whether to emit a presence phrase first.
 */
export function requiresQualityModel(
  content: string,
  settings: Record<string, string>,
): boolean {
  const preference = (settings.model_quality_preference || 'balanced') as QualityPreference;
  if (preference === 'fast') return false;
  if (preference === 'quality') return true;
  return detectTaskType(content) === 'chat_quality';
}

/**
 * Resolve which LLM provider+model to use for a chat message.
 * Falls back down the chain if the preferred model isn't configured.
 */
export function resolveChat(
  content: string,
  settings: Record<string, string>,
  providers: any[],
): ModelRoute {
  const preference = (settings.model_quality_preference || 'balanced') as QualityPreference;
  const messageTask = detectTaskType(content);

  let targetTier: 'fast' | 'balanced' | 'quality';
  if (preference === 'fast') {
    targetTier = 'fast';
  } else if (preference === 'quality') {
    targetTier = 'quality';
  } else {
    // balanced: route by message content
    targetTier = messageTask === 'chat_fast' ? 'fast'
      : messageTask === 'chat_quality' ? 'quality'
      : 'balanced';
  }

  // Tier configs — fall through to primary if tier not configured
  const primaryProvider = settings.companion_provider || 'groq';
  const primaryModel = settings.companion_model || 'llama-3.1-8b-instant';
  const fastProvider = settings.chat_fast_provider || primaryProvider;
  const fastModel = settings.chat_fast_model || primaryModel;
  const qualityProvider = settings.worker_provider || settings.companion_provider || 'groq';
  const qualityModel = settings.worker_model || 'llama-3.3-70b-versatile';

  let chosenProvider: string;
  let chosenModel: string;
  if (targetTier === 'fast') {
    chosenProvider = fastProvider;
    chosenModel = fastModel;
  } else if (targetTier === 'quality') {
    chosenProvider = qualityProvider;
    chosenModel = qualityModel;
  } else {
    // balanced falls back to primary
    chosenProvider = primaryProvider;
    chosenModel = primaryModel;
  }

  // Resolve API key — fallback to primary if chosen provider has no key
  const provObj = providers.find((p: any) => p.id === chosenProvider);
  const apiKey = provObj?.api_key || provObj?.apiKey || '';

  if (!apiKey && chosenProvider !== primaryProvider) {
    const primary = providers.find((p: any) => p.id === primaryProvider);
    return {
      provider: primaryProvider,
      model: primaryModel,
      apiKey: primary?.api_key || primary?.apiKey || '',
    };
  }

  return { provider: chosenProvider, model: chosenModel, apiKey };
}

/** Resolve STT route — Groq Whisper, with retry model available. */
export function resolveSTT(
  settings: Record<string, string>,
  providers: any[],
): STTRoute {
  const model = settings.stt_model || 'whisper-large-v3-turbo';
  const groq = providers.find((p: any) => p.id === 'groq');
  const apiKey = groq?.api_key || groq?.apiKey || '';
  return { model, apiKey };
}

/** Resolve STT retry route — higher-accuracy model for noisy/low-confidence audio. */
export function resolveSTTRetry(
  settings: Record<string, string>,
  providers: any[],
): STTRoute {
  // Use whisper-large-v3 as high-accuracy retry (user can override)
  const model = settings.stt_retry_model || 'whisper-large-v3';
  const groq = providers.find((p: any) => p.id === 'groq');
  const apiKey = groq?.api_key || groq?.apiKey || '';
  return { model, apiKey };
}

/** Resolve TTS route — Groq PlayAI TTS or browser speech synthesis. */
export function resolveTTS(
  settings: Record<string, string>,
  providers: any[],
): TTSRoute {
  const provider = (settings.tts_provider || 'browser') as TTSRoute['provider'];
  const model = settings.tts_model_groq || 'playai-tts';
  const voice = settings.tts_voice_groq || 'Fritz-PlayAI';
  const groq = providers.find((p: any) => p.id === 'groq');
  const apiKey = groq?.api_key || groq?.apiKey || '';
  return { provider, model, voice, apiKey };
}

/** Human-readable label for the resolved route — shown in status bar. */
export function routeLabel(route: ModelRoute): string {
  const shortModel = route.model
    .replace('llama-3.1-', '')
    .replace('llama-3.3-', '')
    .replace('-versatile', '')
    .replace('-instant', '');
  return `${route.provider} / ${shortModel}`;
}

/** Short display name for a model ID. */
export function modelShortName(modelId: string): string {
  if (modelId.includes('8b')) return '8B';
  if (modelId.includes('70b')) return '70B';
  if (modelId.includes('mixtral')) return 'Mixtral';
  if (modelId.includes('gemma')) return 'Gemma';
  if (modelId.includes('deepseek')) return 'DeepSeek';
  return modelId.split('-').slice(-1)[0] ?? modelId;
}
