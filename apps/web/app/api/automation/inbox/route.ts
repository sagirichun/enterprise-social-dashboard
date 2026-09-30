import { NextRequest, NextResponse } from 'next/server';
import { Platform } from '@dashboard/db';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';

/** List inbound comments across the user's accounts, with filters. */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  const platform = searchParams.get('platform');
  const repliedParam = searchParams.get('replied');
  const sentiment = searchParams.get('sentiment');
  const search = searchParams.get('search');
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get('pageSize') ?? 20) || 20),
  );

  // Scope everything to accounts owned by the user.
  const accounts = await db.account.findMany({
    where: {
      userId: user.id,
      ...(accountId ? { id: accountId } : {}),
      ...(platform ? { platform: platform as Platform } : {}),
    },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);

  const where = {
    accountId: { in: accountIds },
    ...(repliedParam !== null
      ? { replied: repliedParam === 'true' }
      : {}),
    ...(sentiment ? { sentiment: sentiment.toUpperCase() } : {}),
    ...(search
      ? {
          OR: [
            { text: { contains: search, mode: 'insensitive' as const } },
            { authorName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, unreplied, comments] = await Promise.all([
    db.commentInbox.count({ where }),
    db.commentInbox.count({
      where: { accountId: { in: accountIds }, replied: false },
    }),
    db.commentInbox.findMany({
      where,
      include: {
        account: {
          select: {
            id: true,
            platform: true,
            profileName: true,
            profileImage: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    comments,
    unrepliedCount: unreplied,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}
