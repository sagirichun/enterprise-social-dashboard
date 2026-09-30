/**
 * Anthropic Claude provider via the Messages API (fetch-based, no SDK).
 * Supports SSE streaming and the /v1/models listing endpoint.
 */

import type {
  AiConfig,
  AiProviderClient,
  ChatMessage,
  GenerateOptions,
  GenerateResult,
} from '../types';
import { AiError } from '../types';

const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  model?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface AnthropicStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string };
  usage?: { output_tokens?: number };
}

interface AnthropicErrorBody {
  error?: { type?: string; message?: string };
}

export class AnthropicProvider implements AiProviderClient {
  readonly name = 'anthropic';
  protected defaultBaseUrl = 'https://api.anthropic.com/v1';

  protected resolveBaseUrl(config: AiConfig): string {
    return (config.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
  }

  protected buildHeaders(config: AiConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey ?? '',
      'anthropic-version': ANTHROPIC_VERSION,
    };
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
    const url = `${this.resolveBaseUrl(config)}/messages`;
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    const stream = options.stream ?? false;
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: options.maxTokens ?? config.maxTokens ?? 1024,
      messages: rest,
      temperature: options.temperature ?? config.temperature ?? 0.7,
      stream,
    };
    if (system) body.system = system;

    const { signal, cancel } = this.withTimeout(options.signal, config.timeoutMs ?? 60_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(config),
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const detail = await this.errorDetail(res);
        throw new AiError(
          `anthropic request failed (HTTP ${res.status}): ${detail}`,
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
      const data = (await res.json()) as AnthropicResponse;
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text as string)
        .join('');
      const usage =
        data.usage != null
          ? {
              promptTokens: data.usage.input_tokens ?? 0,
              completionTokens: data.usage.output_tokens ?? 0,
            }
          : undefined;
      return {
        text,
        model: data.model ?? config.model,
        ...(usage ? { usage } : {}),
        ...(data.stop_reason ? { finishReason: data.stop_reason } : {}),
      };
    } catch (err) {
      if (err instanceof AiError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new AiError(`anthropic request error: ${message}`, this.name, undefined, true);
    } finally {
      cancel();
    }
  }

  private async errorDetail(res: Response): Promise<string> {
    try {
      const data = (await res.json()) as AnthropicErrorBody;
      return data.error?.message ?? res.statusText;
    } catch {
      return await res.text().catch(() => res.statusText);
    }
  }

  /** Parse Anthropic SSE events, forwarding text deltas to onToken. */
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
    let completionTokens: number | undefined;

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
        if (!payload) continue;
        let event: AnthropicStreamEvent;
        try {
          event = JSON.parse(payload) as AnthropicStreamEvent;
        } catch {
          continue;
        }
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          text += event.delta.text;
          onToken(event.delta.text);
        }
        if (event.type === 'message_delta' && event.usage?.output_tokens != null) {
          completionTokens = event.usage.output_tokens;
        }
      }
    }
    return {
      text,
      model: config.model,
      ...(completionTokens != null ? { usage: { completionTokens } } : {}),
    };
  }

  async listModels(config: AiConfig): Promise<string[]> {
    const url = `${this.resolveBaseUrl(config)}/models`;
    const { signal, cancel } = this.withTimeout(undefined, Math.min(config.timeoutMs ?? 30_000, 30_000));
    try {
      const res = await fetch(url, { headers: this.buildHeaders(config), signal });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => m.id).sort();
    } catch {
      return [];
    } finally {
      cancel();
    }
  }
}
