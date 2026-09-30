/**
 * Ollama local provider via the /api/chat endpoint.
 * No API key required. Supports newline-delimited JSON streaming.
 */

import type {
  AiConfig,
  AiProviderClient,
  ChatMessage,
  GenerateOptions,
  GenerateResult,
} from '../types';
import { AiError } from '../types';

interface OllamaChatResponse {
  model?: string;
  message?: { role?: string; content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

export class OllamaProvider implements AiProviderClient {
  readonly name = 'ollama';
  protected defaultBaseUrl = 'http://localhost:11434';

  protected resolveBaseUrl(config: AiConfig): string {
    return (config.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
  }

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
    const url = `${this.resolveBaseUrl(config)}/api/chat`;
    const stream = options.stream ?? false;
    const body = {
      model: config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
      options: {
        temperature: options.temperature ?? config.temperature ?? 0.7,
        num_predict: options.maxTokens ?? config.maxTokens,
      },
    };
    const { signal, cancel } = this.withTimeout(options.signal, config.timeoutMs ?? 120_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new AiError(
          `ollama request failed (HTTP ${res.status}): ${detail.slice(0, 500)}`,
          this.name,
          res.status,
          res.status >= 500,
        );
      }
      if (stream) {
        if (!options.onToken) {
          throw new AiError('stream=true requires options.onToken', this.name);
        }
        return await this.readStream(res, config, options.onToken);
      }
      const data = (await res.json()) as OllamaChatResponse;
      const usage =
        data.prompt_eval_count != null || data.eval_count != null
          ? {
              promptTokens: data.prompt_eval_count ?? 0,
              completionTokens: data.eval_count ?? 0,
            }
          : undefined;
      return {
        text: data.message?.content ?? '',
        model: data.model ?? config.model,
        ...(usage ? { usage } : {}),
        ...(data.done_reason ? { finishReason: data.done_reason } : {}),
      };
    } catch (err) {
      if (err instanceof AiError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new AiError(
        `ollama request error (is the Ollama server running?): ${message}`,
        this.name,
        undefined,
        true,
      );
    } finally {
      cancel();
    }
  }

  /** Parse Ollama NDJSON stream, forwarding message content deltas. */
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
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let data: OllamaChatResponse;
        try {
          data = JSON.parse(trimmed) as OllamaChatResponse;
        } catch {
          continue;
        }
        if (data.model) model = data.model;
        const delta = data.message?.content;
        if (delta) {
          text += delta;
          onToken(delta);
        }
        if (data.done) {
          finishReason = data.done_reason;
          promptTokens = data.prompt_eval_count;
          completionTokens = data.eval_count;
        }
      }
    }
    const usage =
      promptTokens != null || completionTokens != null
        ? { promptTokens: promptTokens ?? 0, completionTokens: completionTokens ?? 0 }
        : undefined;
    return {
      text,
      model,
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
  }

  async listModels(config: AiConfig): Promise<string[]> {
    const url = `${this.resolveBaseUrl(config)}/api/tags`;
    const { signal, cancel } = this.withTimeout(undefined, Math.min(config.timeoutMs ?? 30_000, 30_000));
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return [];
      const data = (await res.json()) as OllamaTagsResponse;
      return (data.models ?? []).map((m) => m.name).sort();
    } catch {
      return [];
    } finally {
      cancel();
    }
  }
}
