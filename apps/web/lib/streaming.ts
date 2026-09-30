// HTTP client for the standalone 24/7 streaming service
// (packages/streaming). The service exposes a small REST API:
//
//   POST /streams          { id, name, videoPath, rtmpUrl, streamKey, loop, ... }
//   POST /streams/:id/stop
//   POST /streams/:id/restart
//   GET  /streams/:id
//   GET  /health
//
// Base URL comes from STREAMING_SERVICE_URL (default http://localhost:8090).

const BASE_URL =
  process.env.STREAMING_SERVICE_URL ?? 'http://localhost:8090';

export interface StartStreamRequest {
  id: string;
  name?: string;
  videoPath: string;
  rtmpUrl: string;
  streamKey: string;
  loop?: boolean;
  enabled?: boolean;
}

export interface StreamServiceStatus {
  id: string;
  name?: string;
  state: 'idle' | 'starting' | 'live' | 'reconnecting' | 'stopped' | 'error';
  pid?: number;
  startedAt?: string;
  uptimeSec: number;
  restarts: number;
  lastError?: string;
  destination: string;
}

export class StreamingServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`Streaming service error (HTTP ${status}): ${message}`);
    this.name = 'StreamingServiceError';
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch (err) {
    throw new StreamingServiceError(
      0,
      `cannot reach streaming service at ${BASE_URL}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const message =
      (data as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new StreamingServiceError(res.status, message);
  }
  return data as T;
}

/** Start (or restart) a looped stream on the streaming engine. */
export async function streamingStart(
  config: StartStreamRequest,
): Promise<StreamServiceStatus> {
  return request<StreamServiceStatus>('/streams', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

/** Stop a running stream on the streaming engine. */
export async function streamingStop(streamId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/streams/${encodeURIComponent(streamId)}/stop`, {
    method: 'POST',
  });
}

/** Restart a stream on the streaming engine. */
export async function streamingRestart(
  streamId: string,
): Promise<StreamServiceStatus> {
  return request<StreamServiceStatus>(
    `/streams/${encodeURIComponent(streamId)}/restart`,
    { method: 'POST' },
  );
}

/** Fetch live status of a stream from the streaming engine. */
export async function streamingStatus(
  streamId: string,
): Promise<StreamServiceStatus | null> {
  try {
    return await request<StreamServiceStatus>(
      `/streams/${encodeURIComponent(streamId)}`,
    );
  } catch (err) {
    if (err instanceof StreamingServiceError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

/** Health check of the streaming service (used for readiness display). */
export async function streamingHealth(): Promise<{
  status: string;
  uptimeSec: number;
  streams: StreamServiceStatus[];
} | null> {
  try {
    return await request('/health');
  } catch {
    return null;
  }
}
