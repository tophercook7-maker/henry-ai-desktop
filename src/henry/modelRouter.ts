/**
 * Henry AI — Model Router
 * Routes each task to the right provider/model based on task type and quality preference.
 * Single source of truth for all model selection logic.
 */

export type TaskType =
  | 'chat_fast'      // quick conversational replies (< ~150 chars input)
  | 'chat_balanced'  // normal chat
  | 'chat_quality'   // long, complex, code, docs
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

/** Detect task type from message content to guide routing in balanced mode. */
export function detectTaskType(content: string): 'chat_fast' | 'chat_balanced' | 'chat_quality' {
  const len = content.trim().length;
  if (len < 120) return 'chat_fast';
  const hasCode = /```|function\s+\w+|class\s+\w+|def\s+\w+|import\s+\w+/.test(content);
  const isDocument = /write.*essay|draft.*report|summarize.*document|create.*plan|business plan|strategy document|full outline/i.test(content);
  if (len > 600 || hasCode || isDocument) return 'chat_quality';
  return 'chat_balanced';
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
  const primaryModel = settings.companion_model || 'llama-3.3-70b-versatile';
  const fastProvider = settings.chat_fast_provider || primaryProvider;
  const fastModel = settings.chat_fast_model || 'llama-3.1-8b-instant';
  const qualityProvider = settings.worker_provider || settings.companion_provider || 'groq';
  const qualityModel = settings.worker_model || primaryModel;

  let chosenProvider: string;
  let chosenModel: string;
  if (targetTier === 'fast') {
    chosenProvider = fastProvider;
    chosenModel = fastModel;
  } else if (targetTier === 'quality') {
    chosenProvider = qualityProvider;
    chosenModel = qualityModel;
  } else {
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

/** Resolve STT route — always Groq Whisper with configurable model. */
export function resolveSTT(
  settings: Record<string, string>,
  providers: any[],
): STTRoute {
  const model = settings.stt_model || 'whisper-large-v3-turbo';
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
  const shortModel = route.model.replace('llama-', '').replace('-versatile', '').replace('-instant', '');
  return `${route.provider} / ${shortModel}`;
}
