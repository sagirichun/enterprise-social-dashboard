/**
 * @dashboard/queue — public entry point.
 *
 * Library usage (safe to import anywhere, no side effects):
 *   import { postPublishQueue, autoReplyQueue, schedulePostPublish } from '@dashboard/queue';
 *
 * Worker usage (starts the background processes):
 *   npx tsx src/index.ts            (from packages/queue)
 *   npm run worker --workspace=@dashboard/web
 *
 * When this file is executed directly it boots every worker; when it is
 * merely imported (e.g. by the Next.js app to enqueue jobs) nothing starts.
 */

import type { Worker } from 'bullmq';
import { createPostPublisherWorker } from './workers/postPublisher';
import { createAutoReplierWorker } from './workers/autoReplier';
import { createMediaProcessorWorker } from './workers/mediaProcessor';
import {
  createSchedulerWorker,
  setupRepeatableJobs,
} from './workers/scheduler';
import { connection } from './queues';

// Library surface: queue handles, job payload types and helpers.
export {
  QUEUE_NAMES,
  autoReplyQueue,
  connection,
  enqueueAutoReply,
  enqueueMediaProcess,
  mediaProcessQueue,
  postPublishQueue,
  schedulePostPublish,
  schedulerQueue,
} from './queues';
export type {
  AutoReplyJobData,
  MediaProcessJobData,
  PostPublishJobData,
} from './queues';
export { createPostPublisherWorker } from './workers/postPublisher';
export { createAutoReplierWorker } from './workers/autoReplier';
export { createMediaProcessorWorker } from './workers/mediaProcessor';
export {
  createSchedulerWorker,
  setupRepeatableJobs,
} from './workers/scheduler';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[worker] missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Boot every background worker and register the repeatable scheduler jobs.
 * Returns a shutdown function for graceful termination.
 */
export async function startWorkers(): Promise<() => Promise<void>> {
  requireEnv('DATABASE_URL');
  requireEnv('REDIS_URL');
  requireEnv('ENCRYPTION_KEY');

  console.log('[worker] starting background workers...');

  const workers: Worker[] = [
    createPostPublisherWorker(),
    createAutoReplierWorker(),
    createMediaProcessorWorker(),
    createSchedulerWorker(),
  ];

  await Promise.all(workers.map((w) => w.waitUntilReady()));
  await setupRepeatableJobs();

  console.log(
    '[worker] all workers running (post-publish, auto-reply, media-process, scheduler)',
  );

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.all(workers.map((w) => w.close()));
    await connection.quit().catch(() => undefined);
  };

  const onSignal = (signal: string) => {
    console.log(`[worker] ${signal} received, closing workers...`);
    void shutdown().then(() => {
      console.log('[worker] shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));

  return shutdown;
}

// Auto-boot only when executed directly (tsx src/index.ts), not on import.
// Detects the entry script by filename so this stays valid whether the
// package is compiled to CommonJS or ESM.
const invokedAsScript = (() => {
  try {
    const entry = process.argv[1] ?? '';
    return /(^|[\\/])index\.(ts|js|mts|cts|mjs|cjs)$/.test(entry);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  startWorkers().catch((err: unknown) => {
    console.error(
      '[worker] fatal startup error:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
