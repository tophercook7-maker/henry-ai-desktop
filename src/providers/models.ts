import type { AIModel } from '../types';

// All available models with current pricing
export const AVAILABLE_MODELS: AIModel[] = [
  // ── OpenAI ──────────────────────────────────────────
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    inputPricePer1M: 2.5,
    outputPricePer1M: 10.0,
    capabilities: ['chat', 'code', 'vision'],
    recommended: 'worker',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.6,
    capabilities: ['chat', 'code', 'vision'],
    recommended: 'companion',
  },
  {
    id: 'o1',
    name: 'o1 (Reasoning)',
    provider: 'openai',
    contextWindow: 200000,
    inputPricePer1M: 15.0,
    outputPricePer1M: 60.0,
    capabilities: ['chat', 'code', 'reasoning'],
    recommended: 'worker',
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini',
    provider: 'openai',
    contextWindow: 128000,
    inputPricePer1M: 3.0,
    outputPricePer1M: 12.0,
    capabilities: ['chat', 'code', 'reasoning'],
  },

  // ── Anthropic ───────────────────────────────────────
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    contextWindow: 200000,
    inputPricePer1M: 3.0,
    outputPricePer1M: 15.0,
    capabilities: ['chat', 'code', 'reasoning', 'vision'],
    recommended: 'worker',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    contextWindow: 200000,
    inputPricePer1M: 0.25,
    outputPricePer1M: 1.25,
    capabilities: ['chat', 'code'],
    recommended: 'companion',
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    contextWindow: 200000,
    inputPricePer1M: 15.0,
    outputPricePer1M: 75.0,
    capabilities: ['chat', 'code', 'reasoning', 'vision'],
    recommended: 'worker',
  },

  // ── Google ──────────────────────────────────────────
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    contextWindow: 1000000,
    inputPricePer1M: 0.1,
    outputPricePer1M: 0.4,
    capabilities: ['chat', 'code', 'vision'],
    recommended: 'companion',
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    contextWindow: 2000000,
    inputPricePer1M: 1.25,
    outputPricePer1M: 5.0,
    capabilities: ['chat', 'code', 'reasoning', 'vision'],
    recommended: 'worker',
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    provider: 'google',
    contextWindow: 1000000,
    inputPricePer1M: 0.075,
    outputPricePer1M: 0.3,
    capabilities: ['chat', 'code'],
    recommended: 'companion',
  },

  // ── Local (Ollama) ─────────────────────────────────
  {
    id: 'llama3.1:70b',
    name: 'Llama 3.1 70B',
    provider: 'ollama',
    contextWindow: 128000,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    capabilities: ['chat', 'code', 'reasoning'],
    recommended: 'worker',
    local: true,
  },
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1 8B',
    provider: 'ollama',
    contextWindow: 128000,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    capabilities: ['chat', 'code'],
    recommended: 'companion',
    local: true,
  },
  {
    id: 'codellama:34b',
    name: 'CodeLlama 34B',
    provider: 'ollama',
    contextWindow: 16000,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    capabilities: ['code'],
    recommended: 'worker',
    local: true,
  },
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    provider: 'ollama',
    contextWindow: 128000,
    inputPricePer1M: 0,
    outputPricePer1M: 0,
    capabilities: ['chat', 'code', 'reasoning'],
    local: true,
  },
];

// Provider metadata
export const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    icon: '🟢',
    description: 'GPT-4o, o1, and more. Best general-purpose AI.',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPrefix: 'sk-',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🟠',
    description: 'Claude models. Excellent for code and long documents.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPrefix: 'sk-ant-',
  },
  google: {
    id: 'google',
    name: 'Google AI',
    icon: '🔵',
    description: 'Gemini models. Massive context windows, great value.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AI',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    icon: '🏠',
    description: 'Run models locally on your machine. Free forever.',
    keyUrl: 'https://ollama.ai',
    keyPrefix: '',
    local: true,
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export function getModelsForProvider(providerId: string): AIModel[] {
  return AVAILABLE_MODELS.filter((m) => m.provider === providerId);
}

export function getModel(modelId: string): AIModel | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === modelId);
}

export function formatPrice(price: number): string {
  if (price === 0) return 'Free';
  if (price < 1) return `$${price.toFixed(3)}`;
  return `$${price.toFixed(2)}`;
}

export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const model = getModel(modelId);
  if (!model) return 0;
  return (
    (inputTokens / 1_000_000) * model.inputPricePer1M +
    (outputTokens / 1_000_000) * model.outputPricePer1M
  );
}
