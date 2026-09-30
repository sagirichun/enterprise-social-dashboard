/**
 * OpenAI chat completions provider (fetch-based, no SDK dependency).
 *
 * Accepts a configurable baseUrl, so the same implementation serves hosted
 * OpenAI, proxies, and any OpenAI-compatible router. Supports SSE streaming.
 */

import type {
  AiConfig,
  AiProviderClient,
  ChatMessage,
  GenerateOptions,
  GenerateResult,
} from '../types';
import { AiError } from '../types';

interface OpenAiChoice {
  message?: { content?: string | null };
  delta?: { content?: string | null };
  finish_reason?: string | null;
}

interface OpenAiChatResponse {
  id?: string;
  model?: string;
  choices?: OpenAiChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAiModelsResponse {
  data?: Array<{ id: string }>;
}

export class OpenAiProvider implements AiProviderClient {
  readonly name: string = 'openai';
  protected defaultBaseUrl = 'https://api.openai.com/v1';

  protected resolveBaseUrl(config: AiConfig): string {
    return (config.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
  }

  protected buildHeaders(config: AiConfig): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    return headers;
  }

  /** Merge the caller's AbortSignal with a timeout. Caller must invoke cancel(). */
  protected withTimeout(
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): { signal: AbortSignal; cancel: () => void } {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => {
      controller.abort(new Error(`AI request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    return {
      signal: controller.signal,
      cancel: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      },
    };
  }

  async chat(
    messages: ChatMessage[],
    options: GenerateOptions,
    config: AiConfig,
  ): Promise<GenerateResult> {
    const url = `${this.resolveBaseUrl(config)}/chat/completions`;
    const stream = options.stream ?? false;
    const body = {
      model: config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? config.maxTokens,
      stream,
    };
    const { signal, cancel } = this.withTimeout(options.signal, config.timeoutMs ?? 60_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(config),
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new AiError(
          `${this.name} request failed (HTTP ${res.status}): ${detail.slice(0, 500)}`,
          this.name,
          res.status,
          res.status === 429 || res.status >= 500,
        );
      }
      if (stream) {
        if (!options.onToken) {
          throw new AiError('stream=true requires options.onToken', this.name);
        }
        return await this.readStream(res, config, options.onToken);
      }
      const data = (await res.json()) as OpenAiChatResponse;
      const choice = data.choices?.[0];
      const usage = data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined;
      return {
        text: choice?.message?.content ?? '',
        model: data.model ?? config.model,
        ...(usage ? { usage } : {}),
        ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
      };
    } catch (err) {
      if (err instanceof AiError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new AiError(`${this.name} request error: ${message}`, this.name, undefined, true);
    } finally {
      cancel();
    }
  }

  /** Parse an SSE chat-completion stream, forwarding deltas to onToken. */
  protected async readStream(
    res: Response,
    config: AiConfig,
    onToken: (token: string) => void,
  ): Promise<GenerateResult> {
    if (!res.body) throw new AiError('Streaming response has no body', this.name);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let model = config.model;
    let finishReason: string | undefined;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let data: OpenAiChatResponse;
        try {
          data = JSON.parse(payload) as OpenAiChatResponse;
        } catch {
          continue; // partial chunk, wait for more data
        }
        if (data.model) model = data.model;
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onToken(delta);
        }
        const fr = data.choices?.[0]?.finish_reason;
        if (fr) finishReason = fr;
      }
    }
    return { text, model, ...(finishReason ? { finishReason } : {}) };
  }

  async listModels(config: AiConfig): Promise<string[]> {
    const url = `${this.resolveBaseUrl(config)}/models`;
    const { signal, cancel } = this.withTimeout(undefined, Math.min(config.timeoutMs ?? 30_000, 30_000));
    try {
      const res = await fetch(url, { headers: this.buildHeaders(config), signal });
      if (!res.ok) return [];
      const data = (await res.json()) as OpenAiModelsResponse;
      return (data.data ?? []).map((m) => m.id).sort();
    } catch {
      return [];
    } finally {
      cancel();
    }
  }
}
