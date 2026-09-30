/**
 * auto-reply worker.
 *
 * Consumes jobs enqueued by the comment webhook pipeline:
 *  1. Loads the CommentInbox row, the target Account and the AutoReplyRule.
 *  2. Applies rule gates: enabled flag, sentiment filter, keyword filter,
 *     per-day reply cap.
 *  3. Generates a reply with the user's configured AI provider
 *     (@dashboard/ai UnifiedAiClient, rendering the rule's promptTemplate).
 *  4. Posts the reply through the platform adapter.
 *  5. Marks the comment replied.
 *
 * All gates that can never pass (rule disabled, comment already handled,
 * missing AI config) raise UnrecoverableError so the job fails fast instead
 * of burning retries.
 */

import { Worker, Job, UnrecoverableError } from 'bullmq';
import { prisma } from '@dashboard/db';
import { UnifiedAiClient, AiProvider, type AiConfig } from '@dashboard/ai';
import {
  connection,
  QUEUE_NAMES,
  type AutoReplyJobData,
} from '../queues';
import { decrypt, getPlatformAdapter } from '../webapp';

const DB_PROVIDER_TO_AI_PROVIDER: Record<string, AiProvider> = {
  OPENAI: AiProvider.OPENAI,
  ANTHROPIC: AiProvider.ANTHROPIC,
  OLLAMA: AiProvider.OLLAMA,
  LMSTUDIO: AiProvider.LMSTUDIO,
  CUSTOM: AiProvider.CUSTOM,
};

/** Render {{comment}} / {{author}} / {{platform}} placeholders. */
export function renderReplyTemplate(
  template: string,
  vars: { comment: string; author: string; platform: string },
): string {
  return template
    .replace(/\{\{\s*comment\s*\}\}/gi, vars.comment)
    .replace(/\{\{\s*author\s*\}\}/gi, vars.author)
    .replace(/\{\{\s*platform\s*\}\}/gi, vars.platform);
}

async function loadAiConfig(userId: string): Promise<AiConfig> {
  const record = await prisma.aiConfig.findUnique({ where: { userId } });
  if (!record) {
    throw new UnrecoverableError(
      `No AI configuration found for user ${userId}; configure an AI provider first`,
    );
  }
  const provider =
    DB_PROVIDER_TO_AI_PROVIDER[record.provider] ?? AiProvider.OPENAI;
  return {
    provider,
    model: record.model,
    ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
    ...(record.apiKeyEncrypted
      ? { apiKey: decrypt(record.apiKeyEncrypted) }
      : {}),
    temperature: record.temperature,
    maxTokens: record.maxTokens,
    ...(record.systemPrompt
      ? { defaultSystemPrompt: record.systemPrompt }
      : {}),
  };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function processAutoReply(job: Job<AutoReplyJobData>): Promise<{
  replyId: string;
  replyText: string;
}> {
  const { commentId, accountId, ruleId } = job.data;

  const comment = await prisma.commentInbox.findFirst({
    where: { id: commentId, accountId },
    include: { account: true },
  });
  if (!comment) {
    throw new UnrecoverableError(`Comment ${commentId} not found`);
  }
  if (comment.replied) {
    return { replyId: '', replyText: comment.replyText ?? '' };
  }

  const account = comment.account;
  if (!account || !account.isActive) {
    throw new UnrecoverableError(
      `Account ${accountId} is missing or inactive; cannot reply`,
    );
  }

  const rule = await prisma.autoReplyRule.findFirst({
    where: { id: ruleId, userId: account.userId },
  });
  if (!rule) {
    throw new UnrecoverableError(`Auto-reply rule ${ruleId} not found`);
  }
  if (!rule.isEnabled) {
    throw new UnrecoverableError(`Auto-reply rule ${ruleId} is disabled`);
  }

  // Sentiment gate: empty filter means "reply regardless of sentiment".
  const sentiment = (comment.sentiment ?? 'NEUTRAL').toUpperCase();
  if (
    rule.sentimentFilter.length > 0 &&
    !rule.sentimentFilter.map((s) => s.toUpperCase()).includes(sentiment)
  ) {
    await prisma.commentInbox.update({
      where: { id: comment.id },
      data: { replied: false },
    });
    throw new UnrecoverableError(
      `Comment sentiment ${sentiment} does not match rule filter`,
    );
  }

  // Keyword gate: empty filter means "no keyword requirement".
  if (rule.keywordFilter.length > 0) {
    const haystack = comment.text.toLowerCase();
    const matched = rule.keywordFilter.some((kw) =>
      haystack.includes(kw.toLowerCase()),
    );
    if (!matched) {
      throw new UnrecoverableError(
        'Comment does not contain any of the rule keywords',
      );
    }
  }

  // Daily reply cap per account (anti-spam).
  const repliesToday = await prisma.commentInbox.count({
    where: {
      accountId: account.id,
      replied: true,
      repliedAt: { gte: startOfToday() },
    },
  });
  if (repliesToday >= rule.maxRepliesPerDay) {
    throw new UnrecoverableError(
      `Daily reply cap (${rule.maxRepliesPerDay}) reached for account ${account.id}`,
    );
  }

  // Generate the reply with the user's AI provider.
  const aiConfig = await loadAiConfig(account.userId);
  const client = new UnifiedAiClient(aiConfig);
  const prompt = renderReplyTemplate(rule.promptTemplate, {
    comment: comment.text,
    author: comment.authorName ?? 'there',
    platform: comment.platform,
  });

  let replyText: string;
  try {
    replyText = (await client.generateText(prompt, {
      temperature: 0.7,
      maxTokens: Math.min(aiConfig.maxTokens ?? 220, 400),
    })).text.trim();
  } catch (err) {
    throw new Error(
      `AI reply generation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!replyText) {
    throw new Error('AI provider returned an empty reply');
  }

  // Post the reply through the platform adapter.
  const adapter = getPlatformAdapter(comment.platform);
  let replyId: string;
  try {
    const result = await adapter.replyToComment({
      accessToken: decrypt(account.accessToken),
      commentExternalId: comment.externalId,
      parentExternalId: comment.parentId,
      replyText,
    });
    replyId = result.replyId;
  } catch (err) {
    throw new Error(
      `Platform reply failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await prisma.commentInbox.update({
    where: { id: comment.id },
    data: { replied: true, replyText, repliedAt: new Date() },
  });

  return { replyId, replyText };
}

export function createAutoReplierWorker(): Worker<AutoReplyJobData> {
  const worker = new Worker<AutoReplyJobData>(
    QUEUE_NAMES.AUTO_REPLY,
    processAutoReply,
    { connection, concurrency: 10 },
  );

  worker.on('completed', (job, result) => {
    console.log(
      `[worker:auto-reply] job ${job.id} completed (platform reply ${result.replyId || 'n/a'})`,
    );
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[worker:auto-reply] job ${job?.id ?? 'unknown'} failed: ${err.message}`,
    );
  });

  worker.on('error', (err) => {
    console.error(`[worker:auto-reply] worker error: ${err.message}`);
  });

  return worker;
}
