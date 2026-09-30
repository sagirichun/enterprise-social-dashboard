import { NextRequest, NextResponse } from 'next/server';
import { enqueueMediaProcess, schedulePostPublish } from '@dashboard/queue';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { schedulePostSchema } from '../../../../lib/validators';

/**
 * Schedule a post for publishing.
 *
 * Body: { postId, scheduledAt? } — scheduledAt defaults to the post's own
 * scheduledAt, then to "now" (publish immediately).
 *
 * The post moves to QUEUED and a delayed BullMQ job (post-publish) is
 * created. Media URLs are validated up-front on the media-process queue so
 * broken media fails the post fast instead of at publish time.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = schedulePostSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const post = await db.post.findFirst({
    where: { id: parsed.data.postId, userId: user.id },
  });
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }
  if (!['DRAFT', 'QUEUED', 'FAILED'].includes(post.status)) {
    return NextResponse.json(
      { error: `Post cannot be scheduled from status ${post.status}` },
      { status: 409 },
    );
  }
  if (post.platforms.length === 0) {
    return NextResponse.json(
      { error: 'Post targets no platforms' },
      { status: 422 },
    );
  }

  const scheduledAt = parsed.data.scheduledAt
    ? new Date(parsed.data.scheduledAt)
    : (post.scheduledAt ?? new Date());
  if (Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: 'Invalid scheduledAt' }, { status: 400 });
  }

  const updated = await db.post.update({
    where: { id: post.id },
    data: {
      status: 'QUEUED',
      scheduledAt,
      errorMessage: null,
    },
  });

  const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
  const jobId = await schedulePostPublish(post.id, user.id, delayMs);

  // Validate each media URL right away (fail fast on broken media).
  const mediaUrls = Array.isArray(post.mediaUrls)
    ? (post.mediaUrls as unknown[]).filter(
        (u): u is string => typeof u === 'string' && u.length > 0,
      )
    : [];
  for (let i = 0; i < mediaUrls.length; i += 1) {
    const mediaUrl = mediaUrls[i] as string;
    await enqueueMediaProcess({
      postId: post.id,
      userId: user.id,
      mediaUrl,
      mediaIndex: i,
    });
  }

  return NextResponse.json({
    post: updated,
    jobId,
    scheduledAt: scheduledAt.toISOString(),
    delayMs,
  });
}
