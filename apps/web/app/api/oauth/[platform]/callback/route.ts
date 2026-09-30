import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '../../../../../lib/auth';
import { decrypt, encrypt } from '../../../../../lib/encryption';
import { db } from '../../../../../lib/db';
import {
  getOAuthHandler,
  isOAuthPlatform,
  platformToEnum,
  redirectUriFor,
} from '../../../../../lib/oauth';

/**
 * OAuth callback: GET /api/oauth/[platform]/callback
 * Verifies state, exchanges the code for tokens, fetches the platform
 * profile(s), and upserts them as connected Accounts (tokens encrypted).
 * Finally redirects back to /dashboard/accounts with a status flag.
 */
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  const { platform } = params;
  const fail = (code: string) =>
    NextResponse.redirect(new URL(`/dashboard/accounts?error=${encodeURIComponent(code)}`, req.url));

  if (!isOAuthPlatform(platform)) return fail('unknown_platform');

  const user = await getAuthUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  const handler = getOAuthHandler(platform);
  if (!handler) return fail('unknown_platform');

  const searchParams = req.nextUrl.searchParams;
  const denied = searchParams.get('error');
  if (denied) {
    return fail(searchParams.get('error_description') ?? denied);
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code || !state) return fail('missing_code_or_state');

  // Verify the state cookie (CSRF protection).
  const rawCookie = req.cookies.get('oauth_state')?.value;
  if (!rawCookie) return fail('missing_state_cookie');
  let payload: { userId: string; platform: string; nonce: string; codeVerifier: string | null };
  try {
    payload = JSON.parse(decrypt(rawCookie));
  } catch {
    return fail('invalid_state');
  }
  if (payload.nonce !== state || payload.userId !== user.id || payload.platform !== platform) {
    return fail('state_mismatch');
  }

  try {
    const redirectUri = redirectUriFor(platform);
    const tokens = await handler.exchangeCode(code, redirectUri, {
      ...(payload.codeVerifier ? { codeVerifier: payload.codeVerifier as string } : {}),
    });
    const profiles = await handler.fetchProfiles(tokens);
    if (profiles.length === 0) return fail('no_profiles_found');

    const enumPlatform = platformToEnum(platform);
    const expiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : undefined;

    for (const profile of profiles) {
      const accessToken = encrypt(profile.accessToken ?? tokens.accessToken);
      const refreshToken = tokens.refreshToken ? encrypt(tokens.refreshToken) : undefined;
      await db.account.upsert({
        where: {
          userId_platform_providerAccountId: {
            userId: user.id,
            platform: enumPlatform,
            providerAccountId: profile.providerAccountId,
          },
        },
        update: {
          accessToken,
          ...(refreshToken ? { refreshToken } : {}),
          ...(expiresAt ? { expiresAt } : {}),
          ...(profile.profileName ? { profileName: profile.profileName } : {}),
          ...(profile.profileUsername ? { profileUsername: profile.profileUsername } : {}),
          ...(profile.profileImage ? { profileImage: profile.profileImage } : {}),
          scopes: tokens.scopes,
          isActive: true,
          lastSyncAt: new Date(),
        },
        create: {
          userId: user.id,
          platform: enumPlatform,
          providerAccountId: profile.providerAccountId,
          accessToken,
          ...(refreshToken ? { refreshToken } : {}),
          ...(expiresAt ? { expiresAt } : {}),
          ...(profile.profileName ? { profileName: profile.profileName } : {}),
          ...(profile.profileUsername ? { profileUsername: profile.profileUsername } : {}),
          ...(profile.profileImage ? { profileImage: profile.profileImage } : {}),
          scopes: tokens.scopes,
          isActive: true,
        },
      });
    }
  } catch (err) {
    console.error(`[oauth:${platform}] callback failed:`, err);
    const message = err instanceof Error ? err.message : 'oauth_failed';
    return fail(message.slice(0, 160));
  }

  const res = NextResponse.redirect(new URL(`/dashboard/accounts?connected=${platform}`, req.url));
  res.cookies.delete('oauth_state');
  return res;
}
