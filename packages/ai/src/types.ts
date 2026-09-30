/**
 * Core types for the flexible AI integration layer.
 *
 * The layer unifies OpenAI, Anthropic Claude, local Ollama / LM Studio servers
 * and any custom OpenAI-compatible router behind a single client interface.
 */

export enum AiProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  OLLAMA = 'ollama',
  LMSTUDIO = 'lmstudio',
  CUSTOM = 'custom',
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiConfig {
  provider: AiProvider;
  /** API key. Not required for Ollama / LM Studio local servers. */
  apiKey?: string;
  /**
   * Override endpoint. Required for CUSTOM (any OpenAI-compatible router),
   * optional for the others to point at proxies or self-hosted gateways.
   */
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Request timeout in milliseconds. Defaults to 60_000. */
  timeoutMs?: number;
  /** Prepended as a system message when the caller does not supply one. */
  defaultSystemPrompt?: string;
}

export interface GenerateOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Enable token streaming; tokens are delivered via onToken. */
  stream?: boolean;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage?: TokenUsage;
  finishReason?: string;
}

export interface SentimentResult {
  label: 'positive' | 'neutral' | 'negative';
  /** -1 (very negative) to 1 (very positive). */
  score: number;
  /** 0 to 1. */
  confidence: number;
}

export interface ReplyContext {
  brandName?: string;
  postTopic?: string;
  /** BCP 47 language tag, e.g. 'en', 'id'. Defaults to the comment's language. */
  language?: string;
  authorName?: string;
  tone?: 'friendly' | 'professional' | 'playful';
}

export interface ContentIdea {
  title: string;
  hook: string;
  format: string;
  hashtags: string[];
}

/**
 * Low-level provider contract. Implemented once per vendor in providers/.
 * The UnifiedAiClient delegates to one of these based on AiConfig.provider.
 */
export interface AiProviderClient {
  readonly name: string;
  chat(messages: ChatMessage[], options: GenerateOptions, config: AiConfig): Promise<GenerateResult>;
  listModels(config: AiConfig): Promise<string[]>;
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export function validateConfig(config: AiConfig): void {
  if (!config || typeof config !== 'object') {
    throw new AiError('AI config is required', 'config');
  }
  if (!config.model || typeof config.model !== 'string') {
    throw new AiError('AI config.model is required', String(config.provider ?? 'config'));
  }
  if (config.provider === AiProvider.CUSTOM && !config.baseUrl) {
    throw new AiError('AI config.baseUrl is required for the custom provider', 'custom');
  }
  if (
    (config.provider === AiProvider.OPENAI || config.provider === AiProvider.ANTHROPIC) &&
    !config.apiKey
  ) {
    throw new AiError(`API key is required for provider "${config.provider}"`, config.provider);
  }
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Coerce a loosely-typed model response into a valid SentimentResult. */
export function normalizeSentiment(raw: unknown): SentimentResult {
  const r = (raw ?? {}) as Partial<SentimentResult>;
  const label = r.label === 'positive' || r.label === 'negative' || r.label === 'neutral' ? r.label : 'neutral';
  return {
    label,
    score: clampNumber(Number(r.score), -1, 1, 0),
    confidence: clampNumber(Number(r.confidence), 0, 1, 0.5),
  };
}
