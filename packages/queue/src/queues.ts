/**
 * BullMQ queue definitions for the Enterprise Social Media Management Dashboard.
 *
 * Queues:
 *  - post-publish   : scheduled / immediate publishing of posts to social platforms
 *  - auto-reply     : AI-generated replies to inbound comments
 *  - media-process  : pre-publish media validation (reachability, type, size)
 *
 * The scheduler worker additionally owns an internal "scheduler" queue for
 * repeatable cron-style jobs (due-post dispatch, token refresh, analytics).
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * Dedicated Redis connection for BullMQ.
 * BullMQ requires maxRetriesPerRequest: null so blocking commands work reliably.
 */
export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on('error', (err: Error) => {
  console.error(`[queue] redis connection error: ${err.message}`);
});

export const QUEUE_NAMES = {
  POST_PUBLISH: 'post-publish',
  AUTO_REPLY: 'auto-reply',
  MEDIA_PROCESS: 'media-process',
  SCHEDULER: 'scheduler',
} as const;

const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 30_000,
  },
  removeOnComplete: 200,
  removeOnFail: 1000,
} as const;

// ---------------------------------------------------------------------------
// Job payloads
// ---------------------------------------------------------------------------

export interface PostPublishJobData {
  postId: string;
  userId: string;
}

export interface AutoReplyJobData {
  /** CommentInbox id. */
  commentId: string;
  accountId: string;
  ruleId: string;
}

export interface MediaProcessJobData {
  postId: string;
  userId: string;
  mediaUrl: string;
  mediaIndex: number;
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export const postPublishQueue = new Queue<PostPublishJobData>(
  QUEUE_NAMES.POST_PUBLISH,
  { connection, defaultJobOptions: { ...DEFAULT_JOB_OPTIONS } },
);

export const autoReplyQueue = new Queue<AutoReplyJobData>(
  QUEUE_NAMES.AUTO_REPLY,
  {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  },
);

export const mediaProcessQueue = new Queue<MediaProcessJobData>(
  QUEUE_NAMES.MEDIA_PROCESS,
  {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10_000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    },
  },
);

export const schedulerQueue = new Queue(
  QUEUE_NAMES.SCHEDULER,
  {
    connection,
    defaultJobOptions: {
      attempts: 2,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  },
);

/**
 * Enqueue (or reschedule) a post publish job.
 * The deterministic job id makes scheduling idempotent: calling it twice for
 * the same post will not create duplicate jobs.
 */
export async function schedulePostPublish(
  postId: string,
  userId: string,
  delayMs: number,
): Promise<string> {
  const job = await postPublishQueue.add(
    'publish',
    { postId, userId },
    {
      jobId: `post:${postId}`,
      delay: Math.max(0, delayMs),
    },
  );
  return job.id as string;
}

/**
 * Enqueue an AI auto-reply job for a stored comment.
 * The deterministic job id keeps redelivered webhooks from double-replying.
 */
export async function enqueueAutoReply(
  data: AutoReplyJobData,
  delayMs = 0,
): Promise<string> {
  const job = await autoReplyQueue.add('reply', data, {
    jobId: `reply:${data.commentId}`,
    delay: Math.max(0, delayMs),
  });
  return job.id as string;
}

/**
 * Enqueue a media validation/processing job for one post attachment.
 * The deterministic job id makes re-scheduling idempotent.
 */
export async function enqueueMediaProcess(
  data: MediaProcessJobData,
): Promise<string> {
  const job = await mediaProcessQueue.add('process', data, {
    jobId: `media:${data.postId}:${data.mediaIndex}`,
  });
  return job.id as string;
}
