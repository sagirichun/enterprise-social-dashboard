/**
 * media-process worker.
 *
 * Pre-publish media validation: for every media URL attached to a scheduled
 * post we verify reachability, detect the content type and enforce size
 * limits. A media URL that can never work (404, wrong content type, too
 * large) fails the post fast with a clear error instead of failing later
 * inside the platform publish calls.
 */

import { Worker, Job, UnrecoverableError } from 'bullmq';
import { prisma } from '@dashboard/db';
import {
  connection,
  QUEUE_NAMES,
  type MediaProcessJobData,
} from '../queues';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_VIDEO_BYTES = 512 * 1024 * 1024; // 512 MB
const FETCH_TIMEOUT_MS = 30_000;

const IMAGE_PREFIXES = ['image/'];
const VIDEO_PREFIXES = ['video/'];

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface MediaValidationResult {
  mediaUrl: string;
  contentType: string;
  sizeBytes: number | null;
  kind: 'image' | 'video' | 'unknown';
  ok: boolean;
}

async function validateMedia(
  data: MediaProcessJobData,
): Promise<MediaValidationResult> {
  const { mediaUrl } = data;

  let head: Response;
  try {
    head = await fetchWithTimeout(mediaUrl, { method: 'HEAD' }, FETCH_TIMEOUT_MS);
  } catch (err) {
    throw new UnrecoverableError(
      `Media URL is unreachable: ${mediaUrl} (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (head.status === 405 || head.status === 501) {
    // Some CDNs reject HEAD; fall back to a ranged GET.
    const ranged = await fetchWithTimeout(
      mediaUrl,
      { method: 'GET', headers: { Range: 'bytes=0-0' } },
      FETCH_TIMEOUT_MS,
    );
    if (!ranged.ok && ranged.status !== 206) {
      throw new UnrecoverableError(
        `Media URL returned HTTP ${ranged.status}: ${mediaUrl}`,
      );
    }
    head = ranged;
  } else if (!head.ok) {
    throw new UnrecoverableError(
      `Media URL returned HTTP ${head.status}: ${mediaUrl}`,
    );
  }

  const contentType = head.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const lengthHeader = head.headers.get('content-length');
  const sizeBytes = lengthHeader ? Number(lengthHeader) : null;

  const isImage = IMAGE_PREFIXES.some((p) => contentType.startsWith(p));
  const isVideo = VIDEO_PREFIXES.some((p) => contentType.startsWith(p));
  const kind = isImage ? 'image' : isVideo ? 'video' : 'unknown';

  if (kind === 'unknown') {
    // Fall back to extension sniffing before giving up.
    const ext = mediaUrl.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
    const videoExts = ['mp4', 'mov', 'webm', 'mkv', 'avi'];
    if (!imageExts.includes(ext) && !videoExts.includes(ext)) {
      throw new UnrecoverableError(
        `Unsupported media type "${contentType || 'unknown'}" for ${mediaUrl}`,
      );
    }
  }

  const limit = kind === 'video' || contentType.startsWith('video/')
    ? MAX_VIDEO_BYTES
    : MAX_IMAGE_BYTES;
  if (sizeBytes !== null && Number.isFinite(sizeBytes) && sizeBytes > limit) {
    throw new UnrecoverableError(
      `Media exceeds size limit (${Math.round(sizeBytes / 1024 / 1024)} MB > ${Math.round(limit / 1024 / 1024)} MB): ${mediaUrl}`,
    );
  }

  return { mediaUrl, contentType, sizeBytes, kind, ok: true };
}

async function processMedia(
  job: Job<MediaProcessJobData>,
): Promise<MediaValidationResult> {
  const result = await validateMedia(job.data);
  console.log(
    `[worker:media] validated ${result.mediaUrl} (${result.contentType || result.kind})`,
  );
  return result;
}

export function createMediaProcessorWorker(): Worker<MediaProcessJobData> {
  const worker = new Worker<MediaProcessJobData>(
    QUEUE_NAMES.MEDIA_PROCESS,
    processMedia,
    { connection, concurrency: 10 },
  );

  worker.on('failed', async (job, err) => {
    console.error(
      `[worker:media] job ${job?.id ?? 'unknown'} failed: ${err.message}`,
    );
    // Fail the owning post fast when media can never be published.
    if (job && err instanceof UnrecoverableError) {
      try {
        await prisma.post.updateMany({
          where: { id: job.data.postId, status: { in: ['DRAFT', 'QUEUED'] } },
          data: {
            status: 'FAILED',
            errorMessage: `Media validation failed: ${err.message}`.slice(0, 2000),
          },
        });
      } catch (dbErr) {
        console.error(
          `[worker:media] could not mark post ${job.data.postId} as FAILED: ${(dbErr as Error).message}`,
        );
      }
    }
  });

  worker.on('error', (err) => {
    console.error(`[worker:media] worker error: ${err.message}`);
  });

  return worker;
}
