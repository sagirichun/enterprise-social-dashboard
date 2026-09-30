/**
 * UnifiedAiClient: the single high-level interface over all AI providers.
 *
 * Provides domain-oriented helpers used across the dashboard:
 * auto-replies, sentiment analysis, content ideas, platform rewrites,
 * and video scripts. All provider differences are hidden behind this API.
 */

import type {
  AiConfig,
  AiProviderClient,
  ChatMessage,
  ContentIdea,
  GenerateOptions,
  GenerateResult,
  ReplyContext,
  SentimentResult,
} from './types';
import { normalizeSentiment } from './types';
import { createProviderClient } from './factory';
import { generateImage as generateImageRequest, testConnection as testConnectionRequest } from './diagnostics';
import type { ImageAspect, TestReport } from './diagnostics';
import {
  AUTO_REPLY_SYSTEM_PROMPT,
  CONTENT_GENERATION_SYSTEM_PROMPT,
  SENTIMENT_ANALYSIS_SYSTEM_PROMPT,
  VIDEO_SCRIPT_SYSTEM_PROMPT,
  buildContentIdeasUserPrompt,
  buildReplyUserPrompt,
  buildRewriteUserPrompt,
  buildSentimentUserPrompt,
  buildVideoScriptUserPrompt,
} from './prompts';
import { extractJson } from './json';

export class UnifiedAiClient {
  readonly config: AiConfig;
  private readonly provider: AiProviderClient;

  constructor(config: AiConfig, provider?: AiProviderClient) {
    this.config = config;
    this.provider = provider ?? createProviderClient(config.provider);
  }

  get providerName(): string {
    return this.provider.name;
  }

  /** Raw text generation with an optional system prompt. */
  async generateText(prompt: string, options: GenerateOptions = {}): Promise<GenerateResult> {
    const messages: ChatMessage[] = [];
    const system = options.systemPrompt ?? this.config.defaultSystemPrompt;
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    return this.provider.chat(messages, options, this.config);
  }

  /** Multi-turn chat; injects the default system prompt if none is present. */
  async chat(messages: ChatMessage[], options: GenerateOptions = {}): Promise<GenerateResult> {
    const msgs = [...messages];
    if (this.config.defaultSystemPrompt && !msgs.some((m) => m.role === 'system')) {
      msgs.unshift({ role: 'system', content: this.config.defaultSystemPrompt });
    }
    return this.provider.chat(msgs, options, this.config);
  }

  /** List available model ids from the provider (best effort). */
  async listModels(): Promise<string[]> {
    return this.provider.listModels(this.config);
  }

  /**
   * Verify the connection with a real minimal request. Never throws: the
   * report captures every step, timings and actionable hints.
   */
  async testConnection(): Promise<TestReport> {
    return testConnectionRequest(this.config);
  }

  /** Generate an image (e.g. a thumbnail) via the provider's image endpoint. */
  async generateImage(prompt: string, aspect: ImageAspect = '16:9') {
    return generateImageRequest(this.config, prompt, aspect);
  }

  /**
   * Generate a brand-safe auto-reply to a social media comment.
   * Used by the auto-reply webhook pipeline.
   */
  async generateReply(comment: string, context: ReplyContext = {}): Promise<string> {
    const result = await this.generateText(buildReplyUserPrompt(comment, context), {
      systemPrompt: AUTO_REPLY_SYSTEM_PROMPT,
      temperature: 0.6,
      maxTokens: 220,
    });
    return result.text.trim();
  }

  /** Analyze the sentiment of a single text. */
  async analyzeSentiment(text: string): Promise<SentimentResult> {
    const result = await this.generateText(buildSentimentUserPrompt(text), {
      systemPrompt: SENTIMENT_ANALYSIS_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 300,
    });
    return normalizeSentiment(extractJson(result.text));
  }

  /** Generate structured content ideas for a topic. */
  async generateContentIdeas(
    topic: string,
    opts: { count?: number; platform?: string; tone?: string; audience?: string } = {},
  ): Promise<ContentIdea[]> {
    const count = opts.count ?? 5;
    const result = await this.generateText(buildContentIdeasUserPrompt(topic, opts), {
      systemPrompt: CONTENT_GENERATION_SYSTEM_PROMPT,
      temperature: 0.9,
      maxTokens: 2000,
    });
    const parsed = extractJson<{ ideas: ContentIdea[] } | ContentIdea[]>(result.text);
    const ideas = Array.isArray(parsed) ? parsed : (parsed.ideas ?? []);
    return ideas
      .filter((i) => i && typeof i.title === 'string')
      .map((i) => ({
        title: i.title,
        hook: i.hook ?? '',
        format: i.format ?? '',
        hashtags: Array.isArray(i.hashtags) ? i.hashtags : [],
      }))
      .slice(0, count);
  }

  /** Rewrite a text to match a target platform's conventions. */
  async rewriteForPlatform(text: string, platform: string): Promise<string> {
    const result = await this.generateText(buildRewriteUserPrompt(text, platform), {
      systemPrompt: CONTENT_GENERATION_SYSTEM_PROMPT,
      temperature: 0.7,
      maxTokens: 600,
    });
    return result.text.trim();
  }

  /** Generate a short-form video script (hook / body / CTA with timestamps). */
  async generateVideoScript(topic: string, durationSec = 60, platform?: string): Promise<string> {
    const result = await this.generateText(buildVideoScriptUserPrompt(topic, durationSec, platform), {
      systemPrompt: VIDEO_SCRIPT_SYSTEM_PROMPT,
      temperature: 0.8,
      maxTokens: 1200,
    });
    return result.text.trim();
  }
}
