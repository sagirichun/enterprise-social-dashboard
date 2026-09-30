import { NextRequest, NextResponse } from 'next/server';
import { Platform } from '@dashboard/db';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { createRuleSchema } from '../../../../lib/validators';

/** List the current user's auto-reply rules. */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  const platform = searchParams.get('platform');

  const rules = await db.autoReplyRule.findMany({
    where: {
      userId: user.id,
      ...(accountId ? { accountId } : {}),
      ...(platform ? { platform: platform as Platform } : {}),
    },
    include: {
      account: {
        select: { id: true, platform: true, profileName: true, profileImage: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ rules });
}

/** Create an auto-reply rule. */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createRuleSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // When an account is given it must belong to the user (and match the platform filter).
  if (data.accountId) {
    const account = await db.account.findFirst({
      where: { id: data.accountId, userId: user.id },
    });
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    if (data.platform && account.platform !== data.platform) {
      return NextResponse.json(
        { error: 'Rule platform does not match the account platform' },
        { status: 422 },
      );
    }
  }

  const rule = await db.autoReplyRule.create({
    data: {
      userId: user.id,
      accountId: data.accountId ?? null,
      platform: data.platform ?? null,
      name: data.name,
      isEnabled: data.isEnabled,
      promptTemplate: data.promptTemplate,
      replyDelaySec: data.replyDelaySec,
      sentimentFilter: data.sentimentFilter,
      keywordFilter: data.keywordFilter,
      maxRepliesPerDay: data.maxRepliesPerDay,
    },
    include: {
      account: {
        select: { id: true, platform: true, profileName: true, profileImage: true },
      },
    },
  });

  return NextResponse.json({ rule }, { status: 201 });
}
