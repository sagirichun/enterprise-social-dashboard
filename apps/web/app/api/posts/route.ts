import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { createPostSchema, postStatusEnum } from '../../../lib/validators';

/** List the current user's posts with status filter + pagination. */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get('status');
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get('pageSize') ?? 20) || 20),
  );

  const status = statusParam
    ? postStatusEnum.safeParse(statusParam).data ?? undefined
    : undefined;

  const where = {
    userId: user.id,
    ...(status ? { status } : {}),
  };

  const [total, posts] = await Promise.all([
    db.post.count({ where }),
    db.post.findMany({
      where,
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    posts,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

/** Create a draft post. Scheduling / immediate publishing goes through /api/posts/schedule. */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createPostSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Every targeted platform needs an active connected account.
  const accounts = await db.account.findMany({
    where: {
      userId: user.id,
      platform: { in: data.platforms },
      isActive: true,
    },
    select: { platform: true },
  });
  const connected = new Set(accounts.map((a) => a.platform));
  const missing = data.platforms.filter((p) => !connected.has(p));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `No active connected account for: ${missing.join(', ')}`,
        missingPlatforms: missing,
      },
      { status: 422 },
    );
  }

  const post = await db.post.create({
    data: {
      userId: user.id,
      content: data.content,
      mediaUrls: data.mediaUrls,
      platforms: data.platforms,
      platformCategories: data.platformCategories ?? {},
      thumbnailUrl: data.thumbnailUrl ?? null,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      status: 'DRAFT',
    },
  });

  return NextResponse.json({ post }, { status: 201 });
}
