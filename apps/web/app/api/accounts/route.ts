import { NextRequest, NextResponse } from 'next/server';
import type { Account } from '@dashboard/db';
import { getAuthUser, unauthorized } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { encrypt } from '../../../lib/encryption';
import { connectAccountSchema } from '../../../lib/validators';

/** Strip encrypted tokens before sending an account to the client. */
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

/** List the current user's connected social accounts. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const accounts = await db.account.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ accounts: accounts.map(sanitizeAccount) });
}

/**
 * Connect (or reconnect) a social account.
 * Called by the OAuth callback handlers after the platform token exchange.
 * Tokens are encrypted at rest and never returned by the API.
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

  const parsed = connectAccountSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const account = await db.account.upsert({
    where: {
      userId_platform_providerAccountId: {
        userId: user.id,
        platform: data.platform,
        providerAccountId: data.providerAccountId,
      },
    },
    update: {
      accessToken: encrypt(data.accessToken),
      ...(data.refreshToken ? { refreshToken: encrypt(data.refreshToken) } : {}),
      ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt) } : {}),
      ...(data.profileName !== undefined ? { profileName: data.profileName } : {}),
      ...(data.profileUsername !== undefined ? { profileUsername: data.profileUsername } : {}),
      ...(data.profileImage !== undefined ? { profileImage: data.profileImage || null } : {}),
      scopes: data.scopes,
      isActive: true,
      lastSyncAt: new Date(),
    },
    create: {
      userId: user.id,
      platform: data.platform,
      providerAccountId: data.providerAccountId,
      accessToken: encrypt(data.accessToken),
      refreshToken: data.refreshToken ? encrypt(data.refreshToken) : null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      profileName: data.profileName ?? null,
      profileUsername: data.profileUsername ?? null,
      profileImage: data.profileImage || null,
      scopes: data.scopes,
    },
  });

  return NextResponse.json({ account: sanitizeAccount(account) }, { status: 201 });
}
