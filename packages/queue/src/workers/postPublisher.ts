/**
 * post-publish worker.
 *
 * Publishes a Post to every targeted platform via the platform adapters.
 * - Idempotent: platforms already recorded in post.platformPostIds are skipped,
 *   so BullMQ retries never double-post.
 * - Retryable platform errors (429 / 5xx) bubble up and are retried with
 *   exponential backoff; non-retryable errors (4xx validation etc.) become
 *   UnrecoverableError so the job fails fast.
 * - Refreshed OAuth tokens returned by adapters are persisted (encrypted).
 */

import { Worker, Job, UnrecoverableError } from 'bullmq';
import { prisma, Platform } from '@dashboard/db';
import {
  connection,
  QUEUE_NAMES,
  type PostPublishJobData,
} from '../queues';
import {
  decrypt,
  encrypt,
  getPlatformAdapter,
  PlatformApiError,
} from '../webapp';

const MAX_MEDIA_BYTES = 512 * 1024 * 1024;

function isRetryableError(err: unknown): boolean {
  if (err instanceof PlatformApiError) return err.isRetryable();
  // Network-level failures (fetch TypeError, timeouts) are worth retrying.
  if (err instanceof TypeError) return true;
  return false;
}

async function processPostPublish(job: Job<PostPublishJobData>): Promise<{
  published: Record<string, string>;
  errors: string[];
}> {
  const { postId, userId } = job.data;

  const post = await prisma.post.findFirst({
    where: { id: postId, userId },
  });
  if (!post) {
    throw new UnrecoverableError(`Post ${postId} not found`);
  }
  if (post.status === 'PUBLISHED') {
    return { published: (post.platformPostIds as Record<string, string>) ?? {}, errors: [] };
  }

  await prisma.post.update({
    where: { id: postId },
    data: { status: 'PUBLISHING', retryCount: { increment: 1 } },
  });

  const mediaUrls = Array.isArray(post.mediaUrls)
    ? (post.mediaUrls as unknown[]).filter(
        (u): u is string => typeof u === 'string' && u.length > 0,
      )
    : [];
  const alreadyPublished = (post.platformPostIds ?? {}) as Record<string, string>;
  const pendingPlatforms = post.platforms.filter((p) => !alreadyPublished[p]);
  const categories = (post.platformCategories ?? {}) as Record<string, string>;
  const thumbnailUrl =
    typeof post.thumbnailUrl === 'string' && post.thumbnailUrl.length > 0
      ? post.thumbnailUrl
      : undefined;

  if (pendingPlatforms.length === 0 && post.platforms.length > 0) {
    await prisma.post.update({
      where: { id: postId },
      data: { status: 'PUBLISHED', publishedAt: post.publishedAt ?? new Date() },
    });
    return { published: alreadyPublished, errors: [] };
  }

  const accounts = await prisma.account.findMany({
    where: {
      userId,
      platform: { in: pendingPlatforms as Platform[] },
      isActive: true,
    },
  });

  const published: Record<string, string> = { ...alreadyPublished };
  const errors: string[] = [];

  for (const platformName of pendingPlatforms) {
    const account = accounts.find((a) => a.platform === platformName);
    if (!account) {
      errors.push(`${platformName}: no active connected account`);
      continue;
    }

    try {
      const adapter = getPlatformAdapter(platformName);
      const result = await adapter.publishPost({
        accessToken: decrypt(account.accessToken),
        refreshToken: account.refreshToken
          ? decrypt(account.refreshToken)
          : undefined,
        content: post.content,
        mediaUrls,
        category: categories[platformName],
        thumbnailUrl,
        account: {
          providerAccountId: account.providerAccountId,
          profileName: account.profileName,
        },
      });

      published[platformName] = result.platformPostId;

      // Persist rotated tokens so subsequent jobs keep working.
      if (result.newAccessToken) {
        await prisma.account.update({
          where: { id: account.id },
          data: {
            accessToken: encrypt(result.newAccessToken),
            ...(result.newRefreshToken
              ? { refreshToken: encrypt(result.newRefreshToken) }
              : {}),
            ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${platformName}: ${message}`);
      // Persist partial progress so a retry only attempts what is left.
      await prisma.post.update({
        where: { id: postId },
        data: { platformPostIds: published, errorMessage: errors.join(' | ') },
      });
      if (!isRetryableError(err)) {
        throw new UnrecoverableError(
          `Non-retryable publish error on ${platformName}: ${message}`,
        );
      }
      throw err;
    }
  }

  if (Object.keys(published).length === 0) {
    // Nothing went out; let BullMQ retry the whole job.
    await prisma.post.update({
      where: { id: postId },
      data: { status: 'PUBLISHING', errorMessage: errors.join(' | ') },
    });
    throw new Error(`Publish failed on all platforms: ${errors.join(' | ')}`);
  }

  await prisma.post.update({
    where: { id: postId },
    data: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      platformPostIds: published,
      // Keep partial-failure notes for the UI; null when everything succeeded.
      errorMessage: errors.length > 0 ? errors.join(' | ') : null,
    },
  });

  return { published, errors };
}

export function createPostPublisherWorker(): Worker<PostPublishJobData> {
  const worker = new Worker<PostPublishJobData>(
    QUEUE_NAMES.POST_PUBLISH,
    processPostPublish,
    { connection, concurrency: 5 },
  );

  worker.on('completed', (job, result) => {
    console.log(
      `[worker:post-publish] job ${job.id} completed: ${Object.keys(result.published).length} platform(s) published`,
    );
  });

  worker.on('failed', async (job, err) => {
    console.error(
      `[worker:post-publish] job ${job?.id ?? 'unknown'} failed: ${err.message}`,
    );
    // Mark the post FAILED only when no attempts remain.
    if (job && job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      try {
        await prisma.post.update({
          where: { id: job.data.postId },
          data: {
            status: 'FAILED',
            errorMessage: `Failed after ${job.attemptsMade + 1} attempt(s): ${err.message}`.slice(0, 2000),
          },
        });
      } catch (dbErr) {
        console.error(
          `[worker:post-publish] could not mark post ${job.data.postId} as FAILED: ${(dbErr as Error).message}`,
        );
      }
    }
  });

  worker.on('error', (err) => {
    console.error(`[worker:post-publish] worker error: ${err.message}`);
  });

  return worker;
}

export { MAX_MEDIA_BYTES };
