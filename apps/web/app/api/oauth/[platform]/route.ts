import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { encrypt } from '../../../../lib/encryption';
import {
  getOAuthHandler,
  isOAuthPlatform,
  redirectUriFor,
  createPkcePair,
  createStateNonce,
} from '../../../../lib/oauth';

/**
 * Start the OAuth connect flow: GET /api/oauth/[platform]
 * Requires a signed-in user; redirects the browser to the platform's
 * authorization page. The platform redirects back to
 * /api/oauth/[platform]/callback.
 */
export async function GET(req: NextRequest, { params }: { params: { platform: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { platform } = params;
  if (!isOAuthPlatform(platform)) {
    return NextResponse.json({ error: 'Unknown platform' }, { status: 404 });
  }

  const handler = getOAuthHandler(platform);
  if (!handler) {
    return NextResponse.json({ error: 'Unknown platform' }, { status: 404 });
  }

  if (!handler.isConfigured()) {
    return NextResponse.redirect(
      new URL(`/dashboard/accounts?error=${platform}_not_configured`, req.url)
    );
  }

  const redirectUri = redirectUriFor(platform);
  const state = createStateNonce();
  const pkce = platform === 'x' ? createPkcePair() : null;

  const payload = encrypt(
    JSON.stringify({
      userId: user.id,
      platform,
      nonce: state,
      codeVerifier: pkce?.verifier ?? null,
    })
  );

  const authorizationUrl = handler.authorizationUrl(state, redirectUri, {
    ...(pkce ? { codeChallenge: pkce.challenge } : {}),
  });

  const res = NextResponse.redirect(authorizationUrl);
  res.cookies.set('oauth_state', payload, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: req.nextUrl.protocol === 'https:',
  });
  return res;
}
