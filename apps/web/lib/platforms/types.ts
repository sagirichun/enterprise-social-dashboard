// Common contracts for social platform adapters.
// Every adapter implements publishPost(), replyToComment() and getAnalytics()
// against the platform's official HTTP API, with uniform error handling.

export type PlatformName =
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'YOUTUBE'
  | 'X'
  | 'THREADS'
  | 'LINKEDIN';

export class PlatformApiError extends Error {
  platform: PlatformName | string;
  status: number;
  code?: string | undefined;

  constructor(
    platform: PlatformName | string,
    status: number,
    message: string,
    code?: string,
  ) {
    super(`[${platform}] ${message}`);
    this.name = 'PlatformApiError';
    this.platform = platform;
    this.status = status;
    this.code = code;
  }

  /** 429 and 5xx are worth retrying with backoff. */
  isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * Parse a fetch Response, throwing PlatformApiError on non-2xx.
 * Understands the common error shapes (Meta, Google, X, TikTok).
 */
export async function parseApiResponse(
  platform: PlatformName | string,
  res: Response,
): Promise<unknown> {
  const text = await res.text();
  type ErrorBody = {
    error?: { message?: string; code?: number | string; type?: string };
    error_description?: string;
    message?: string;
    errors?: Array<{ message?: string }>;
  };
  let data: ErrorBody | null = null;
  try {
    data = text ? (JSON.parse(text) as ErrorBody) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.error_description ||
      data?.message ||
      data?.errors?.[0]?.message ||
      (text ? text.slice(0, 300) : `HTTP ${res.status}`);
    const code = data?.error?.code ?? data?.error?.type;
    throw new PlatformApiError(
      platform,
      res.status,
      message,
      code !== undefined ? String(code) : undefined,
    );
  }
  return data;
}

export interface PublishPostInput {
  /** Decrypted user-context access token. */
  accessToken: string;
  refreshToken?: string | undefined;
  content: string;
  /** Publicly reachable media URLs (images / videos). */
  mediaUrls: string[];
  /** Post category for this platform, e.g. "video", "shorts", "reel", "story", "post", "carousel". */
  category?: string | undefined;
  /** Optional thumbnail image URL (uploaded or AI-generated). */
  thumbnailUrl?: string | undefined;
  account: {
    providerAccountId: string;
    profileName?: string | null;
  };
}

export interface PublishPostResult {
  /** Platform-side post id (tweet id, media id, video id, ...). */
  platformPostId: string;
  /** Public URL of the published post when the API returns one. */
  url?: string;
  /** Set when the platform rotated tokens during the call. */
  newAccessToken?: string;
  newRefreshToken?: string;
  expiresAt?: Date;
}

export interface ReplyToCommentInput {
  accessToken: string;
  /** Platform-side comment id to reply to. */
  commentExternalId: string;
  /** Platform-side parent object id (video/post) when the API needs it. */
  parentExternalId?: string | null;
  replyText: string;
}

export interface ReplyToCommentResult {
  replyId: string;
}

export interface AnalyticsInput {
  accessToken: string;
  providerAccountId: string;
  since?: Date;
  until?: Date;
}

export interface AnalyticsResult {
  followers: number;
  engagement: number;
  impressions: number;
  clicks: Record<string, number>;
}

export interface PlatformAdapter {
  platform: PlatformName;
  publishPost(input: PublishPostInput): Promise<PublishPostResult>;
  replyToComment(input: ReplyToCommentInput): Promise<ReplyToCommentResult>;
  getAnalytics(input: AnalyticsInput): Promise<AnalyticsResult>;
  /** Exchange a refresh token for a new access token, when supported. */
  refreshAccessToken?(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
  }>;
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi'];

function extensionOf(url: string): string {
  const clean = url.split('?')[0] ?? '';
  return (clean.split('.').pop() ?? '').toLowerCase();
}

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.includes(extensionOf(url));
}

export function isImageUrl(url: string): boolean {
  return IMAGE_EXTENSIONS.includes(extensionOf(url));
}

/** Best-effort content type for a local /uploads/* URL (by extension). */
export function contentTypeForUploadsUrl(url: string): string {
  const ext = extensionOf(url);
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DownloadedMedia {
  buffer: Buffer;
  contentType: string;
  sizeBytes: number;
}

/** Download a remote media file into memory with a size guard. */
export async function downloadMedia(
  url: string,
  maxBytes = 512 * 1024 * 1024,
): Promise<DownloadedMedia> {
  // Local uploads served by the web app (file manager) are read from disk —
  // the worker runs on the same machine, so no HTTP round-trip is needed.
  if (url.startsWith('/uploads/')) {
    const { promises: fs } = await import('fs');
    const { resolveLocalPath } = await import('../../lib/media-store');
    const abs = resolveLocalPath(url);
    if (!abs) {
      throw new Error(`Invalid local media path: ${url}`);
    }
    const buffer = await fs.readFile(abs);
    if (buffer.length > maxBytes) {
      throw new Error(
        `Media file too large (${buffer.length} bytes > ${maxBytes} bytes)`,
      );
    }
    return {
      buffer,
      contentType: contentTypeForUploadsUrl(url),
      sizeBytes: buffer.length,
    };
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download media (HTTP ${res.status}): ${url}`);
  }
  const declared = res.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    throw new Error(
      `Media file too large (${declared} bytes > ${maxBytes} bytes)`,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(
      `Media file too large (${buffer.length} bytes > ${maxBytes} bytes)`,
    );
  }
  return {
    buffer,
    contentType: res.headers.get('content-type')?.split(';')[0]?.trim() ??
      'application/octet-stream',
    sizeBytes: buffer.length,
  };
}
