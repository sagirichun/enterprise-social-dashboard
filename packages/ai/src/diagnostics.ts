/**
 * Connection diagnostics and image generation for @dashboard/ai.
 *
 * testConnection() performs a tiny real request against the configured
 * provider and records every stage with timings, so the UI can show a
 * step-by-step log instead of a bare success/failure. Network and HTTP
 * errors are classified into actionable hints (wrong base URL, bad key,
 * model not found, ...).
 *
 * generateImage() targets the OpenAI-compatible /images/generations
 * endpoint for AI thumbnails.
 */

import { AiError, AiProvider, type AiConfig } from './types';

export interface TestStep {
  label: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

export interface TestReport {
  ok: boolean;
  latencyMs: number;
  model: string;
  steps: TestStep[];
  error?: string;
}

export type ImageAspect = '16:9' | '9:16' | '1:1';

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

const IMAGE_SIZES: Record<ImageAspect, { size: string; width: number; height: number }> = {
  '16:9': { size: '1792x1024', width: 1792, height: 1024 },
  '9:16': { size: '1024x1792', width: 1024, height: 1792 },
  '1:1': { size: '1024x1024', width: 1024, height: 1024 },
};

const DEFAULT_BASE_URLS: Record<string, string> = {
  [AiProvider.OPENAI]: 'https://api.openai.com/v1',
  [AiProvider.ANTHROPIC]: 'https://api.anthropic.com/v1',
  [AiProvider.OLLAMA]: 'http://localhost:11434',
  [AiProvider.LMSTUDIO]: 'http://localhost:1234/v1',
};

function resolveBaseUrl(config: AiConfig): string {
  return (config.baseUrl ?? DEFAULT_BASE_URLS[config.provider] ?? '').replace(/\/+$/, '');
}

function parseHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * Turn a low-level failure into an actionable message for the user.
 * Returns { message, hint } where hint is extra guidance for the UI.
 */
function classifyError(err: unknown, provider: string, baseUrl: string): { message: string; hint: string } {
  const code = (err as { cause?: { code?: string } } | null)?.cause?.code
    ?? (err as { code?: string } | null)?.code;
  const raw = err instanceof Error ? err.message : String(err);
  const host = parseHost(baseUrl);

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      message: `DNS lookup failed for "${host}".`,
      hint: 'Check the base URL hostname. If this is a local server, make sure it is reachable from this machine (localhost works only when the AI server runs on the same host).',
    };
  }
  if (code === 'ECONNREFUSED') {
    return {
      message: `Connection refused by "${host}".`,
      hint: 'The server is not reachable at this host/port. Is the AI server running? Check the port number in the base URL.',
    };
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return {
      message: `Network error while reaching "${host}" (${code}).`,
      hint: 'Check your network connection and that the base URL is correct.',
    };
  }
  if (
    (err instanceof Error && err.name === 'AbortError') ||
    /timed out/i.test(raw)
  ) {
    return {
      message: 'Request timed out after 30s.',
      hint: 'The server did not answer in time. For local servers, the first request can be slow while the model loads — try again.',
    };
  }
  if (err instanceof AiError && err.statusCode) {
    const body = raw.slice(0, 300);
    switch (err.statusCode) {
      case 401:
        return {
          message: '401 Unauthorized — the API key was rejected.',
          hint: 'Double-check the API key: no extra spaces, and that it belongs to this endpoint.',
        };
      case 403:
        return {
          message: '403 Forbidden.',
          hint: 'The key is valid but lacks permission for this model or endpoint.',
        };
      case 404:
        return {
          message: `404 Not Found on ${provider === 'anthropic' ? '/messages' : provider === 'ollama' ? '/api/chat' : '/chat/completions'}.`,
          hint: 'Wrong base URL path. For OpenAI-compatible gateways the base URL usually ends with /v1 (e.g. https://api.9router.ai/v1). For Ollama use http://host:11434 with no path.',
        };
      case 429:
        return {
          message: '429 Rate limited.',
          hint: 'The provider is throttling requests. Wait a moment and retry.',
        };
      default:
        if (err.statusCode === 400 && /model/i.test(body)) {
          return {
            message: `The provider rejected the model name ("${body.slice(0, 120)}").`,
            hint: 'Check that the model name is exactly right for this endpoint (model lists differ per gateway).',
          };
        }
        if (err.statusCode >= 500) {
          return {
            message: `Provider server error (HTTP ${err.statusCode}).`,
            hint: 'The AI service itself failed. Retry in a bit; if it persists the problem is on their side.',
          };
        }
        return {
          message: `HTTP ${err.statusCode}: ${body}`,
          hint: 'See the detail above; the provider rejected the request.',
        };
    }
  }
  return {
    message: raw || 'Unknown error',
    hint: 'Check the base URL, API key and model name, then retry.',
  };
}

interface ProbeResult {
  ok: boolean;
  text: string;
  error?: { message: string; hint: string };
}

/** Send the tiny "Reply with the word OK." probe appropriate for the provider. */
async function probe(config: AiConfig, baseUrl: string, timeoutMs: number): Promise<ProbeResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let url: string;
  let body: Record<string, unknown>;

  if (config.provider === AiProvider.ANTHROPIC) {
    url = `${baseUrl}/messages`;
    headers['x-api-key'] = config.apiKey ?? '';
    delete headers.Authorization;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: config.model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with the word OK.' }],
    };
  } else if (config.provider === AiProvider.OLLAMA) {
    url = `${baseUrl}/api/chat`;
    body = {
      model: config.model,
      stream: false,
      messages: [{ role: 'user', content: 'Reply with the word OK.' }],
      options: { num_predict: 8, temperature: 0 },
    };
  } else {
    url = `${baseUrl}/chat/completions`;
    body = {
      model: config.model,
      messages: [{ role: 'user', content: 'Reply with the word OK.' }],
      max_tokens: 8,
      temperature: 0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out after 30000ms')), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const classified = classifyError(
        new AiError(`${config.provider} probe failed (HTTP ${res.status}): ${detail}`, config.provider, res.status),
        config.provider,
        baseUrl,
      );
      return { ok: false, text: '', error: classified };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      message?: { content?: string | null };
      content?: Array<{ text?: string }>;
    };
    const text =
      data.choices?.[0]?.message?.content ??
      data.message?.content ??
      (Array.isArray(data.content) ? data.content.map((b) => b.text ?? '').join('') : '') ??
      '';
    return { ok: true, text: String(text).trim() };
  } catch (err) {
    return { ok: false, text: '', error: classifyError(err, config.provider, baseUrl) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify a config with a real minimal request. Never throws: every failure
 * is captured in the returned report with steps, timings and hints.
 */
export async function testConnection(config: AiConfig): Promise<TestReport> {
  const started = Date.now();
  const steps: TestStep[] = [];
  const push = (label: string, ok: boolean, ms: number, detail?: string): void => {
    steps.push(detail ? { label, ok, ms, detail } : { label, ok, ms });
  };

  // Step 1: validate configuration.
  let t0 = Date.now();
  const baseUrl = resolveBaseUrl(config);
  if (!config.model || typeof config.model !== 'string') {
    push('Validate configuration', false, Date.now() - t0, 'Model name is required.');
    return { ok: false, latencyMs: Date.now() - started, model: config.model ?? '', steps, error: 'Model name is required.' };
  }
  if (config.provider === AiProvider.CUSTOM && !config.baseUrl) {
    push('Validate configuration', false, Date.now() - t0, 'Base URL is required for the Custom provider.');
    return { ok: false, latencyMs: Date.now() - started, model: config.model, steps, error: 'Base URL is required for the Custom provider.' };
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(baseUrl);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    const detail = `Base URL "${baseUrl || '(empty)'}" is not a valid http(s) URL.`;
    push('Validate configuration', false, Date.now() - t0, detail);
    return { ok: false, latencyMs: Date.now() - started, model: config.model, steps, error: detail };
  }
  const needsV1Hint =
    (config.provider === AiProvider.CUSTOM || config.provider === AiProvider.OPENAI) &&
    !/\/v1\/?$/.test(baseUrl);
  push(
    'Validate configuration',
    true,
    Date.now() - t0,
    `provider=${config.provider}, model=${config.model}, base=${baseUrl}` +
      (needsV1Hint ? ' — note: OpenAI-compatible gateways usually need /v1 at the end' : ''),
  );

  // Step 2: send the probe request (DNS + connect + TLS + HTTP happen here).
  t0 = Date.now();
  const probePath =
    config.provider === AiProvider.ANTHROPIC ? '/messages' : config.provider === AiProvider.OLLAMA ? '/api/chat' : '/chat/completions';
  const probeResult = await probe(config, baseUrl, 30_000);
  const probeMs = Date.now() - t0;
  if (!probeResult.ok) {
    const msg = probeResult.error?.message ?? 'Request failed';
    push(`POST ${probePath}`, false, probeMs, msg);
    const full = `${msg} ${probeResult.error?.hint ?? ''}`.trim();
    return { ok: false, latencyMs: Date.now() - started, model: config.model, steps, error: full };
  }
  push(`POST ${probePath}`, true, probeMs, `HTTP 200 in ${probeMs}ms`);

  // Step 3: read the reply.
  t0 = Date.now();
  if (!probeResult.text) {
    push('Read reply', false, Date.now() - t0, 'The provider returned an empty reply.');
    return {
      ok: false,
      latencyMs: Date.now() - started,
      model: config.model,
      steps,
      error: 'The provider returned an empty reply. The endpoint is reachable but did not answer the test prompt.',
    };
  }
  push('Read reply', true, Date.now() - t0, `Got reply: "${probeResult.text.slice(0, 60)}"`);

  return { ok: true, latencyMs: Date.now() - started, model: config.model, steps };
}

/**
 * Generate an image (thumbnail) via the OpenAI-compatible /images/generations
 * endpoint. Supports b64_json and url response formats.
 * Throws AiError with statusCode 404 when the provider has no image endpoint.
 */
export async function generateImage(
  config: AiConfig,
  prompt: string,
  aspect: ImageAspect = '16:9',
): Promise<GeneratedImage> {
  if (config.provider === AiProvider.ANTHROPIC) {
    throw new AiError(
      'Image generation is not supported by the Anthropic provider. Use an OpenAI-compatible endpoint (OpenAI, 9Router, or another custom gateway).',
      'anthropic',
      404,
    );
  }
  if (config.provider === AiProvider.OLLAMA) {
    throw new AiError(
      'Image generation is not supported by Ollama (text models only). Use an OpenAI-compatible endpoint with an image model.',
      'ollama',
      404,
    );
  }
  const mapping = IMAGE_SIZES[aspect] ?? IMAGE_SIZES['16:9'];
  const baseUrl = resolveBaseUrl(config);
  if (!baseUrl) {
    throw new AiError('Base URL is required for image generation.', config.provider);
  }
  const url = `${baseUrl}/images/generations`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Image request timed out after 120000ms')), 120_000);
  timer.unref?.();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.model, prompt, size: mapping.size, n: 1 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new AiError(
          `This endpoint does not support image generation (HTTP 404 on /images/generations). The configured model ("${config.model}") is probably a text-only model — switch to an image model such as dall-e-3.`,
          config.provider,
          404,
        );
      }
      throw new AiError(
        `Image generation failed (HTTP ${res.status}): ${detail.slice(0, 500)}`,
        config.provider,
        res.status,
      );
    }
    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const item = data.data?.[0];
    if (!item) {
      throw new AiError('Image generation returned no image data.', config.provider);
    }
    if (item.b64_json) {
      return {
        buffer: Buffer.from(item.b64_json, 'base64'),
        mimeType: 'image/png',
        width: mapping.width,
        height: mapping.height,
      };
    }
    if (item.url) {
      const imgRes = await fetch(item.url);
      if (!imgRes.ok) {
        throw new AiError(`Could not download the generated image (HTTP ${imgRes.status}).`, config.provider);
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mimeType = imgRes.headers.get('content-type')?.split(';')[0] ?? 'image/png';
      return { buffer: buf, mimeType, width: mapping.width, height: mapping.height };
    }
    throw new AiError('Image generation returned an unsupported response format.', config.provider);
  } catch (err) {
    if (err instanceof AiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AiError(`Image generation error: ${message}`, config.provider);
  } finally {
    clearTimeout(timer);
  }
}
