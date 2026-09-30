import { NextRequest, NextResponse } from 'next/server';
import type { Account } from '@dashboard/db';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { updateAccountSchema } from '../../../../lib/validators';

function sanitizeAccount(account: Account) {
  const { accessToken: _a, refreshToken: _r, ...rest } = account;
  void _a;
  void _r;
  return {
    ...rest,
    hasAccessToken: Boolean(account.accessToken),
    hasRefreshToken: Boolean(account.refreshToken),
  };
}

interface RouteParams {
  params: { id: string };
}

/** Update account metadata / active flag. Tokens are never updatable here. */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const account = await db.account.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = updateAccountSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const updated = await db.account.update({
    where: { id: account.id },
    data: {
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.profileName !== undefined ? { profileName: data.profileName } : {}),
      ...(data.profileUsername !== undefined ? { profileUsername: data.profileUsername } : {}),
      ...(data.profileImage !== undefined ? { profileImage: data.profileImage || null } : {}),
    },
  });

  return NextResponse.json({ account: sanitizeAccount(updated) });
}

/** Disconnect an account (cascades to its comments, rules and snapshots). */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const account = await db.account.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  await db.account.delete({ where: { id: account.id } });

  return NextResponse.json({ ok: true, deletedId: account.id });
}
