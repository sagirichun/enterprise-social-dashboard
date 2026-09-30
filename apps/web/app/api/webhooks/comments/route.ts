import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { autoReplyQueue } from '@dashboard/queue';
import { UnifiedAiClient } from '@dashboard/ai';
import { db } from '../../../../lib/db';
import { commentWebhookSchema } from '../../../../lib/validators';
import { getAiClientConfig } from '../../../../lib/ai-config';

/**
 * Inbound comment webhook.
 *
 * Platform event pipelines (Meta, TikTok, ...) POST normalized comment
 * payloads here. The handler stores the comment, runs best-effort sentiment
 * analysis, matches it against the user's enabled auto-reply rules and, on a
 * match, enqueues a delayed auto-reply job.
 */

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

function isValidSignature(rawBody: string, req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] WEBHOOK_SECRET is not set; accepting unsigned payload');
    return true;
  }
  const header =
    req.headers.get('x-hub-signature-256') ??
    req.headers.get('x-webhook-signature');
  if (!header) return false;

  const provided = header.startsWith('sha256=') ? header : `sha256=${header}`;
  const expected =
    'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// ---------------------------------------------------------------------------
// Meta subscription handshake (GET)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ---------------------------------------------------------------------------
// Comment ingestion (POST)
// ---------------------------------------------------------------------------

function matchesKeywordFilter(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const haystack = text.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!isValidSignature(rawBody, req)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = commentWebhookSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const account = await db.account.findFirst({
    where: {
      platform: data.platform,
      providerAccountId: data.providerAccountId,
      isActive: true,
    },
    include: { user: { select: { id: true } } },
  });

  // Acknowledge unknown accounts with 200 so platforms stop retrying.
  if (!account) {
    return NextResponse.json({
      ok: true,
      stored: false,
      reason: 'unknown_account',
    });
  }

  // Best-effort sentiment analysis with the user's AI provider.
  let sentiment: string | null = null;
  let sentimentScore: number | null = null;
  try {
    const aiConfig = await getAiClientConfig(account.user.id);
    if (aiConfig) {
      const client = new UnifiedAiClient(aiConfig);
      const result = await client.analyzeSentiment(data.text);
      sentiment = result.label.toUpperCase();
      sentimentScore = result.score;
    }
  } catch (err) {
    console.warn(
      `[webhook] sentiment analysis failed: ${(err as Error).message}`,
    );
  }

  const comment = await db.commentInbox.upsert({
    where: {
      accountId_externalId: {
        accountId: account.id,
        externalId: data.externalId,
      },
    },
    update: {
      text: data.text,
      authorName: data.authorName ?? null,
      authorAvatar: data.authorAvatar || null,
      ...(sentiment ? { sentiment, sentimentScore } : {}),
    },
    create: {
      accountId: account.id,
      platform: data.platform,
      externalId: data.externalId,
      parentId: data.parentId ?? null,
      authorName: data.authorName ?? null,
      authorAvatar: data.authorAvatar || null,
      text: data.text,
      sentiment,
      sentimentScore,
    },
  });

  // If we have seen this comment before there is nothing more to do.
  if (comment.replied) {
    return NextResponse.json({
      ok: true,
      stored: true,
      commentId: comment.id,
      enqueued: false,
      reason: 'already_replied',
    });
  }

  // Find the most specific enabled rule: account rule > platform rule > global.
  const rules = await db.autoReplyRule.findMany({
    where: {
      userId: account.user.id,
      isEnabled: true,
      OR: [
        { accountId: account.id },
        { accountId: null, platform: data.platform },
        { accountId: null, platform: null },
      ],
    },
  });
  const ranked = rules
    .map((rule) => ({
      rule,
      specificity: rule.accountId
        ? 2
        : rule.platform
          ? 1
          : 0,
    }))
    .sort((a, b) => b.specificity - a.specificity);

  let matchedRule: (typeof rules)[number] | null = null;
  for (const { rule } of ranked) {
    if (
      rule.sentimentFilter.length > 0 &&
      sentiment &&
      !rule.sentimentFilter.map((s) => s.toUpperCase()).includes(sentiment)
    ) {
      continue;
    }
    if (!matchesKeywordFilter(data.text, rule.keywordFilter)) {
      continue;
    }
    matchedRule = rule;
    break;
  }

  if (!matchedRule) {
    return NextResponse.json({
      ok: true,
      stored: true,
      commentId: comment.id,
      enqueued: false,
      reason: 'no_matching_rule',
    });
  }

  const job = await autoReplyQueue.add(
    'reply',
    { commentId: comment.id, accountId: account.id, ruleId: matchedRule.id },
    {
      delay: matchedRule.replyDelaySec * 1000,
      jobId: `reply:${comment.id}`,
    },
  );

  return NextResponse.json({
    ok: true,
    stored: true,
    commentId: comment.id,
    enqueued: true,
    jobId: job.id,
    ruleId: matchedRule.id,
    replyInSec: matchedRule.replyDelaySec,
  });
}
