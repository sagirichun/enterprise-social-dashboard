/**
 * OAuth connect flow for social platforms.
 *
 * Used by /api/oauth/[platform] (start) and /api/oauth/[platform]/callback.
 * Tokens are encrypted with apps/web/lib/encryption.ts before storage and
 * never leave the server unencrypted.
 *
 * Required env vars per platform (see .env.example):
 *   Facebook/Instagram: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_REDIRECT_URI
 *   TikTok:             TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI
 *   YouTube:            YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REDIRECT_URI
 *   X:                  TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, TWITTER_REDIRECT_URI
 *                       (callback URL registered in the X dev portal must be
 *                        <APP_URL>/api/oauth/x/callback)
 *   Threads:            THREADS_APP_ID, THREADS_APP_SECRET, THREADS_REDIRECT_URI
 */

import { randomBytes, createHash } from 'crypto';

export type OAuthPlatform = 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'x' | 'threads';

export const OAUTH_PLATFORMS: OAuthPlatform[] = [
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'threads',
];

export interface OAuthProfile {
  providerAccountId: string;
  profileName?: string | undefined;
  profileUsername?: string | undefined;
  profileImage?: string | undefined;
  /** Platform-scoped access token (e.g. Facebook Page token). Defaults to the OAuth access token. */
  accessToken?: string | undefined;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresIn?: number | undefined;
  scopes: string[];
}

interface PlatformHandler {
  authorizationUrl(state: string, redirectUri: string, extra: { codeChallenge?: string }): string;
  exchangeCode(code: string, redirectUri: string, extra: { codeVerifier?: string }): Promise<TokenSet>;
  fetchProfiles(tokens: TokenSet): Promise<OAuthProfile[]>;
  isConfigured(): boolean;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

async function postForm(url: string, params: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

async function getJson(url: string, accessToken: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Profile fetch failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Facebook (Pages) — also backs Instagram via linked business accounts
// ---------------------------------------------------------------------------

const FB_API = 'https://graph.facebook.com/v19.0';

const facebookHandler: PlatformHandler = {
  isConfigured: () => Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
  authorizationUrl: (state, redirectUri) => {
    const scope = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'instagram_basic',
      'instagram_content_publish',
    ].join(',');
    const q = new URLSearchParams({
      client_id: requireEnv('FACEBOOK_APP_ID'),
      redirect_uri: redirectUri,
      state,
      scope,
      response_type: 'code',
    });
    return `https://www.facebook.com/v19.0/dialog/oauth?${q}`;
  },
  exchangeCode: async (code, redirectUri) => {
    const appId = requireEnv('FACEBOOK_APP_ID');
    const appSecret = requireEnv('FACEBOOK_APP_SECRET');
    // Short-lived user token...
    const shortQ = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const shortRes = await fetch(`${FB_API}/oauth/access_token?${shortQ}`);
    const shortJson = (await shortRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!shortRes.ok || !shortJson.access_token) {
      throw new Error(`Facebook token exchange failed: ${JSON.stringify(shortJson).slice(0, 300)}`);
    }
    // ...exchanged for a 60-day token.
    const longQ = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: String(shortJson.access_token),
    });
    const longRes = await fetch(`${FB_API}/oauth/access_token?${longQ}`);
    const longJson = (await longRes.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      accessToken: String(longJson.access_token ?? shortJson.access_token),
      expiresIn: typeof longJson.expires_in === 'number' ? longJson.expires_in : undefined,
      scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    };
  },
  fetchProfiles: async (tokens) => {
    const q = new URLSearchParams({
      fields: 'id,name,username,access_token',
      access_token: tokens.accessToken,
    });
    const res = await fetch(`${FB_API}/me/accounts?${q}`);
    const json = (await res.json().catch(() => ({}))) as { data?: Array<Record<string, string>> };
    if (!res.ok) throw new Error(`Facebook pages fetch failed: ${JSON.stringify(json).slice(0, 300)}`);
    return (json.data ?? [])
      .filter((p) => typeof p.id === 'string' && p.id.length > 0)
      .map((p) => ({
        providerAccountId: p.id as string,
        profileName: p.name,
        profileUsername: p.username,
        accessToken: p.access_token ?? tokens.accessToken,
      }));
  },
};

const instagramHandler: PlatformHandler = {
  isConfigured: facebookHandler.isConfigured,
  authorizationUrl: facebookHandler.authorizationUrl,
  exchangeCode: facebookHandler.exchangeCode,
  fetchProfiles: async (tokens) => {
    const q = new URLSearchParams({
      fields: 'id,name,instagram_business_account{id,username}',
      access_token: tokens.accessToken,
    });
    const res = await fetch(`${FB_API}/me/accounts?${q}`);
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ id: string; name: string; instagram_business_account?: { id: string; username: string } }>;
    };
    if (!res.ok) throw new Error(`Instagram accounts fetch failed: ${JSON.stringify(json).slice(0, 300)}`);
    const out: OAuthProfile[] = [];
    for (const page of json.data ?? []) {
      const ig = page.instagram_business_account;
      if (!ig) continue;
      // Best-effort profile picture.
      let profileImage: string | undefined;
      try {
        const pq = new URLSearchParams({ fields: 'profile_picture_url', access_token: tokens.accessToken });
        const pr = await fetch(`${FB_API}/${ig.id}?${pq}`);
        const pj = (await pr.json().catch(() => ({}))) as { profile_picture_url?: string };
        profileImage = pj.profile_picture_url;
      } catch {
        /* non-fatal */
      }
      out.push({
        providerAccountId: ig.id,
        profileName: page.name,
        profileUsername: ig.username,
        profileImage,
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

const tiktokHandler: PlatformHandler = {
  isConfigured: () => Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
  authorizationUrl: (state, redirectUri) => {
    const q = new URLSearchParams({
      client_key: requireEnv('TIKTOK_CLIENT_KEY'),
      scope: 'user.info.basic,video.upload,video.publish',
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
  },
  exchangeCode: async (code, redirectUri) => {
    const json = await postForm('https://open.tiktokapis.com/v2/oauth/token/', {
      client_key: requireEnv('TIKTOK_CLIENT_KEY'),
      client_secret: requireEnv('TIKTOK_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
      scopes: String(json.scope ?? '').split(',').filter(Boolean),
    };
  },
  fetchProfiles: async (tokens) => {
    const json = await getJson(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username',
      tokens.accessToken
    );
    const u = (json.data as { user?: Record<string, string> } | undefined)?.user ?? {};
    return [
      {
        providerAccountId: u.open_id ?? u.union_id ?? 'unknown',
        profileName: u.display_name,
        profileUsername: u.username,
        profileImage: u.avatar_url,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// YouTube (Google OAuth2)
// ---------------------------------------------------------------------------

const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

const youtubeHandler: PlatformHandler = {
  isConfigured: () => Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
  authorizationUrl: (state, redirectUri) => {
    const q = new URLSearchParams({
      client_id: requireEnv('YOUTUBE_CLIENT_ID'),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: YT_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  exchangeCode: async (code, redirectUri) => {
    const json = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: requireEnv('YOUTUBE_CLIENT_ID'),
      client_secret: requireEnv('YOUTUBE_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
      scopes: String(json.scope ?? '').split(' ').filter(Boolean),
    };
  },
  fetchProfiles: async (tokens) => {
    const json = await getJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', tokens.accessToken);
    const items = (json.items as Array<{ id: string; snippet?: Record<string, unknown> }> | undefined) ?? [];
    return items.map((ch) => {
      const snip = ch.snippet ?? {};
      const thumbs = (snip.thumbnails as Record<string, { url?: string }> | undefined) ?? {};
      return {
        providerAccountId: ch.id,
        profileName: typeof snip.title === 'string' ? snip.title : undefined,
        profileUsername: typeof snip.customUrl === 'string' ? snip.customUrl : undefined,
        profileImage: thumbs.default?.url ?? thumbs.medium?.url,
      };
    });
  },
};

// ---------------------------------------------------------------------------
// X (Twitter) — OAuth 2.0 + PKCE
// ---------------------------------------------------------------------------

const xHandler: PlatformHandler = {
  isConfigured: () => Boolean(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET),
  authorizationUrl: (state, redirectUri, extra) => {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: requireEnv('TWITTER_CLIENT_ID'),
      redirect_uri: redirectUri,
      scope: 'tweet.read tweet.write users.read offline.access',
      state,
      code_challenge: extra.codeChallenge ?? '',
      code_challenge_method: 'S256',
    });
    return `https://twitter.com/i/oauth2/authorize?${q}`;
  },
  exchangeCode: async (code, redirectUri, extra) => {
    const clientId = requireEnv('TWITTER_CLIENT_ID');
    const clientSecret = requireEnv('TWITTER_CLIENT_SECRET');
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const json = await postForm(
      'https://api.twitter.com/2/oauth2/token',
      {
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: extra.codeVerifier ?? '',
      },
      { Authorization: `Basic ${basic}` }
    );
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
      expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
      scopes: String(json.scope ?? '').split(' ').filter(Boolean),
    };
  },
  fetchProfiles: async (tokens) => {
    const json = await getJson('https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name', tokens.accessToken);
    const d = (json.data as Record<string, string> | undefined) ?? {};
    return [
      {
        providerAccountId: d.id ?? 'unknown',
        profileName: d.name,
        profileUsername: d.username,
        profileImage: d.profile_image_url,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

const threadsHandler: PlatformHandler = {
  isConfigured: () => Boolean(process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET),
  authorizationUrl: (state, redirectUri) => {
    const q = new URLSearchParams({
      client_id: requireEnv('THREADS_APP_ID'),
      redirect_uri: redirectUri,
      scope: 'threads_basic,threads_content_publish',
      response_type: 'code',
      state,
    });
    return `https://threads.net/oauth/authorize?${q}`;
  },
  exchangeCode: async (code, redirectUri) => {
    const json = await postForm('https://graph.threads.net/oauth/access_token', {
      client_id: requireEnv('THREADS_APP_ID'),
      client_secret: requireEnv('THREADS_APP_SECRET'),
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    return {
      accessToken: String(json.access_token),
      scopes: ['threads_basic', 'threads_content_publish'],
    };
  },
  fetchProfiles: async (tokens) => {
    const res = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url&access_token=${tokens.accessToken}`
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, string>;
    if (!res.ok) throw new Error(`Threads profile fetch failed: ${JSON.stringify(json).slice(0, 300)}`);
    return [
      {
        providerAccountId: json.id ?? 'unknown',
        profileUsername: json.username,
        profileName: json.username,
        profileImage: json.threads_profile_picture_url,
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Registry + helpers
// ---------------------------------------------------------------------------

const handlers: Record<OAuthPlatform, PlatformHandler> = {
  facebook: facebookHandler,
  instagram: instagramHandler,
  tiktok: tiktokHandler,
  youtube: youtubeHandler,
  x: xHandler,
  threads: threadsHandler,
};

export function getOAuthHandler(platform: string): PlatformHandler | null {
  if (!isOAuthPlatform(platform)) return null;
  return handlers[platform];
}

export function isOAuthPlatform(value: string): value is OAuthPlatform {
  return (OAUTH_PLATFORMS as string[]).includes(value);
}

/** Map the URL slug to the Prisma Platform enum value. */
export function platformToEnum(platform: OAuthPlatform): 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'X' | 'THREADS' {
  return platform.toUpperCase() as 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'X' | 'THREADS';
}

export function redirectUriFor(platform: OAuthPlatform): string {
  const envName = `${platform === 'x' ? 'TWITTER' : platform.toUpperCase()}_REDIRECT_URI`;
  const explicit = process.env[envName];
  if (explicit) return explicit;
  const base = (process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/api/oauth/${platform}/callback`;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** PKCE pair for X (Twitter) OAuth 2.0. */
export function createPkcePair(): PkcePair {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Random `state` nonce for CSRF protection. */
export function createStateNonce(): string {
  return b64url(randomBytes(24));
}
