// Threads (Threads API via graph.threads.net) adapter.
// providerAccountId is the Threads user ID. The access token needs
// threads_basic + threads_content_publish scopes.

import {
  PlatformApiError,
  isImageUrl,
  isVideoUrl,
  parseApiResponse,
  sleep,
  type AnalyticsInput,
  type AnalyticsResult,
  type PlatformAdapter,
  type PublishPostInput,
  type PublishPostResult,
  type ReplyToCommentInput,
  type ReplyToCommentResult,
} from './types';
import { toPublicMediaUrl } from '../media-store';

const GRAPH_BASE = 'https://graph.threads.net/v1.0';

type MediaType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'CAROUSEL';

async function api<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  const body = new URLSearchParams({ access_token: accessToken, ...params });
  const url = method === 'GET' ? `${GRAPH_BASE}${path}?${body.toString()}` : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    method,
    ...(method === 'POST'
      ? {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        }
      : {}),
  });
  return (await parseApiResponse('THREADS', res)) as T;
}

interface ContainerResponse {
  id?: string;
}

interface ContainerStatus {
  status_code?: 'IN_PROGRESS' | 'READY' | 'ERROR' | 'EXPIRED';
  error_message?: string;
}

async function waitForContainerReady(
  creationId: string,
  accessToken: string,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await api<ContainerStatus>(
      `/${creationId}?fields=status_code,error_message`,
      accessToken,
    );
    if (status.status_code === 'READY') return;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new PlatformApiError(
        'THREADS',
        422,
        `Threads media container failed: ${status.error_message ?? status.status_code}`,
      );
    }
    await sleep(5000);
  }
  throw new PlatformApiError('THREADS', 504, 'Timed out waiting for Threads media container');
}

async function createContainer(
  userId: string,
  accessToken: string,
  opts: {
    mediaType: MediaType;
    text: string;
    imageUrl?: string;
    videoUrl?: string;
    imageUrls?: string[];
    replyToId?: string;
  },
): Promise<string> {
  const params: Record<string, string> = {
    media_type: opts.mediaType,
    text: opts.text.slice(0, 500),
  };
  if (opts.imageUrl) params.image_url = opts.imageUrl;
  if (opts.videoUrl) params.video_url = opts.videoUrl;
  if (opts.imageUrls?.length) {
    // Carousel children: each child is its own container, then attached.
    const children: string[] = [];
    for (const url of opts.imageUrls.slice(0, 10)) {
      const child = await api<ContainerResponse>(
        `/${userId}/threads`,
        accessToken,
        { media_type: 'IMAGE', image_url: url, is_carousel_item: 'true' },
        'POST',
      );
      if (!child.id) throw new PlatformApiError('THREADS', 422, 'Carousel item creation failed');
      children.push(child.id);
    }
    params.children = children.join(',');
  }
  if (opts.replyToId) params.reply_to_id = opts.replyToId;

  const container = await api<ContainerResponse>(
    `/${userId}/threads`,
    accessToken,
    params,
    'POST',
  );
  if (!container.id) {
    throw new PlatformApiError('THREADS', 422, 'Threads container creation returned no id');
  }
  if (opts.mediaType === 'VIDEO' || opts.mediaType === 'CAROUSEL') {
    await waitForContainerReady(container.id, accessToken);
  }
  return container.id;
}

async function publishContainer(
  userId: string,
  accessToken: string,
  creationId: string,
): Promise<string> {
  const published = await api<{ id?: string }>(
    `/${userId}/threads_publish`,
    accessToken,
    { creation_id: creationId },
    'POST',
  );
  if (!published.id) {
    throw new PlatformApiError('THREADS', 422, 'Threads publish returned no id');
  }
  return published.id;
}

export const threadsAdapter: PlatformAdapter = {
  platform: 'THREADS',

  async publishPost(input: PublishPostInput): Promise<PublishPostResult> {
    const userId = input.account.providerAccountId;
    const urls = input.mediaUrls.map(toPublicMediaUrl);
    const videos = urls.filter(isVideoUrl);
    const images = urls.filter(isImageUrl);

    let mediaType: MediaType = 'TEXT';
    const opts: {
      mediaType: MediaType;
      text: string;
      imageUrl?: string;
      videoUrl?: string;
      imageUrls?: string[];
    } = { mediaType, text: input.content };

    if (videos.length > 0 && videos[0]) {
      mediaType = 'VIDEO';
      opts.mediaType = mediaType;
      opts.videoUrl = videos[0];
    } else if (images.length === 1 && images[0]) {
      mediaType = 'IMAGE';
      opts.mediaType = mediaType;
      opts.imageUrl = images[0];
    } else if (images.length > 1) {
      mediaType = 'CAROUSEL';
      opts.mediaType = mediaType;
      opts.imageUrls = images;
    }

    const creationId = await createContainer(userId, input.accessToken, opts);
    const postId = await publishContainer(userId, input.accessToken, creationId);
    return { platformPostId: postId };
  },

  async replyToComment(input: ReplyToCommentInput): Promise<ReplyToCommentResult> {
    // Threads models replies as top-level posts with reply_to_id.
    // The user id is resolved from the token via /me.
    const me = await api<{ id?: string }>('/me', input.accessToken);
    if (!me.id) throw new PlatformApiError('THREADS', 422, 'Could not resolve Threads user id');
    const creationId = await createContainer(me.id, input.accessToken, {
      mediaType: 'TEXT',
      text: input.replyText,
      replyToId: input.commentExternalId,
    });
    const replyId = await publishContainer(me.id, input.accessToken, creationId);
    return { replyId };
  },

  async getAnalytics(input: AnalyticsInput): Promise<AnalyticsResult> {
    const since = Math.floor(
      (input.since ?? new Date(Date.now() - 28 * 24 * 3600 * 1000)).getTime() / 1000,
    );
    const until = Math.floor((input.until ?? new Date()).getTime() / 1000);
    const insights = await api<{
      data?: Array<{ name?: string; values?: Array<{ value?: number }> }>;
    }>(
      `/${input.providerAccountId}/threads_insights` +
        `?metric=views,likes,replies,reposts,quotes&since=${since}&until=${until}`,
      input.accessToken,
    );

    let views = 0;
    let engagement = 0;
    for (const metric of insights.data ?? []) {
      const total = (metric.values ?? []).reduce((s, v) => s + (v.value ?? 0), 0);
      if (metric.name === 'views') views += total;
      else engagement += total;
    }

    const profile = await api<{ followers_count?: number }>(
      `/${input.providerAccountId}?fields=followers_count`,
      input.accessToken,
    );

    return {
      followers: profile.followers_count ?? 0,
      engagement,
      impressions: views,
      clicks: {},
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
  }> {
    // Threads long-lived token exchange (same flow as Instagram/Facebook).
    const appSecret = process.env.THREADS_APP_SECRET;
    if (!appSecret) {
      throw new PlatformApiError(
        'THREADS',
        500,
        'THREADS_APP_SECRET is not configured',
      );
    }
    const params = new URLSearchParams({
      grant_type: 'th_exchange_token',
      client_secret: appSecret,
      th_exchange_token: refreshToken,
    });
    const res = await fetch(`${GRAPH_BASE}/access_token?${params.toString()}`);
    const data = (await parseApiResponse('THREADS', res)) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new PlatformApiError('THREADS', 422, 'Token exchange returned no access token');
    }
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in ?? 5184000,
    };
  },
};
