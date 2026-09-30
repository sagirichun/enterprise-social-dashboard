/**
 * scheduler worker — cron-like repeatable jobs.
 *
 * Registers and processes three recurring maintenance jobs:
 *  - dispatch-due-posts     (every minute)  enqueue QUEUED posts whose
 *      scheduledAt has arrived but have no live publish job (safety net for
 *      jobs lost to Redis restarts / deploys).
 *  - refresh-expiring-tokens (hourly)       proactively refresh OAuth tokens
 *      expiring within the next hour via the platform adapters.
 *  - collect-analytics      (daily 02:00)   pull follower/engagement stats
 *      per active account and upsert AnalyticsSnapshot rows.
 */

import { Worker, Job } from 'bullmq';
import { prisma } from '@dashboard/db';
import {
  connection,
  schedulerQueue,
  postPublishQueue,
  QUEUE_NAMES,
} from '../queues';
import { decrypt, encrypt, getPlatformAdapter } from '../webapp';

type SchedulerJobName =
  | 'dispatch-due-posts'
  | 'refresh-expiring-tokens'
  | 'collect-analytics';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Safety net: any QUEUED post whose scheduledAt is in the past gets a
 * publish job. The deterministic job id (`post:<id>`) means this is a no-op
 * when the original delayed job is still alive in Redis.
 */
async function dispatchDuePosts(): Promise<{ dispatched: number }> {
  const now = new Date();
  const due = await prisma.post.findMany({
    where: { status: 'QUEUED', scheduledAt: { lte: now } },
    select: { id: true, userId: true },
    take: 200,
  });

  let dispatched = 0;
  for (const post of due) {
    try {
      await postPublishQueue.add(
        'publish',
        { postId: post.id, userId: post.userId },
        { jobId: `post:${post.id}` },
      );
      dispatched += 1;
    } catch (err) {
      // Duplicate job id => the delayed job already exists. Not an error.
      const message = err instanceof Error ? err.message : String(err);
      if (!/already exists/i.test(message)) {
        console.error(
          `[scheduler] failed to dispatch post ${post.id}: ${message}`,
        );
      }
    }
  }
  return { dispatched };
}

/** Refresh OAuth tokens expiring within the next hour. */
async function refreshExpiringTokens(): Promise<{ refreshed: number; failed: number }> {
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  const accounts = await prisma.account.findMany({
    where: {
      isActive: true,
      refreshToken: { not: null },
      expiresAt: { lte: soon },
    },
    take: 200,
  });

  let refreshed = 0;
  let failed = 0;
  for (const account of accounts) {
    try {
      const adapter = getPlatformAdapter(account.platform);
      if (!adapter.refreshAccessToken) continue;
      if (!account.refreshToken) continue;
      const result = await adapter.refreshAccessToken(
        decrypt(account.refreshToken),
      );
      await prisma.account.update({
        where: { id: account.id },
        data: {
          accessToken: encrypt(result.accessToken),
          ...(result.refreshToken
            ? { refreshToken: encrypt(result.refreshToken) }
            : {}),
          expiresAt: new Date(Date.now() + result.expiresIn * 1000),
          lastSyncAt: new Date(),
        },
      });
      refreshed += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[scheduler] token refresh failed for account ${account.id} (${account.platform}): ${(err as Error).message}`,
      );
    }
  }
  return { refreshed, failed };
}

/** Pull per-account analytics and upsert today's snapshot. */
async function collectAnalytics(): Promise<{ collected: number; failed: number }> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    take: 500,
  });
  const today = startOfToday();

  let collected = 0;
  let failed = 0;
  for (const account of accounts) {
    try {
      const adapter = getPlatformAdapter(account.platform);
      const stats = await adapter.getAnalytics({
        accessToken: decrypt(account.accessToken),
        providerAccountId: account.providerAccountId,
      });
      await prisma.analyticsSnapshot.upsert({
        where: {
          accountId_date: { accountId: account.id, date: today },
        },
        update: {
          followers: stats.followers,
          engagement: stats.engagement,
          impressions: stats.impressions,
          clicks: stats.clicks ?? {},
        },
        create: {
          accountId: account.id,
          date: today,
          followers: stats.followers,
          engagement: stats.engagement,
          impressions: stats.impressions,
          clicks: stats.clicks ?? {},
        },
      });
      collected += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[scheduler] analytics collection failed for account ${account.id} (${account.platform}): ${(err as Error).message}`,
      );
    }
  }
  await prisma.account.updateMany({
    where: { id: { in: accounts.map((a) => a.id) } },
    data: { lastSyncAt: new Date() },
  });
  return { collected, failed };
}

async function processSchedulerJob(job: Job): Promise<unknown> {
  const name = job.name as SchedulerJobName;
  switch (name) {
    case 'dispatch-due-posts':
      return dispatchDuePosts();
    case 'refresh-expiring-tokens':
      return refreshExpiringTokens();
    case 'collect-analytics':
      return collectAnalytics();
    default:
      console.warn(`[scheduler] unknown job name: ${job.name}`);
      return { skipped: true };
  }
}

/** Register the repeatable jobs (idempotent across restarts). */
export async function setupRepeatableJobs(): Promise<void> {
  await schedulerQueue.add(
    'dispatch-due-posts',
    {},
    { repeat: { every: 60_000 }, jobId: 'repeat:dispatch-due-posts' },
  );
  await schedulerQueue.add(
    'refresh-expiring-tokens',
    {},
    { repeat: { every: 3_600_000 }, jobId: 'repeat:refresh-expiring-tokens' },
  );
  await schedulerQueue.add(
    'collect-analytics',
    {},
    { repeat: { pattern: '0 2 * * *' }, jobId: 'repeat:collect-analytics' },
  );
  console.log('[scheduler] repeatable jobs registered');
}

export function createSchedulerWorker(): Worker {
  const worker = new Worker(QUEUE_NAMES.SCHEDULER, processSchedulerJob, {
    connection,
    concurrency: 1,
  });

  worker.on('completed', (job, result) => {
    console.log(
      `[scheduler] job ${job.name} completed: ${JSON.stringify(result)}`,
    );
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[scheduler] job ${job?.name ?? 'unknown'} failed: ${err.message}`,
    );
  });

  worker.on('error', (err) => {
    console.error(`[scheduler] worker error: ${err.message}`);
  });

  return worker;
}
