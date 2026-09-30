// Facebook (Meta Graph API) adapter.
// providerAccountId is the Facebook Page ID. The access token must be a
// Page access token with pages_manage_posts / pages_read_engagement.

import {
  PlatformApiError,
  isImageUrl,
  isVideoUrl,
  parseApiResponse,
  type AnalyticsInput,
  type AnalyticsResult,
  type PlatformAdapter,
  type PublishPostInput,
  type PublishPostResult,
  type ReplyToCommentInput,
  type ReplyToCommentResult,
} from './types';
import { toPublicMediaUrl } from '../media-store';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface GraphResponse {
  id?: string;
  post_id?: string;
  followers_count?: number;
  fan_count?: number;
  data?: Array<{
    name?: string;
    values?: Array<{ value?: number | Record<string, number> }>;
  }>;
  access_token?: string;
  expires_in?: number;
  error?: { message?: string; code?: number; type?: string };
}

async function graph<T = GraphResponse>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  const body = new URLSearchParams({
    access_token: accessToken,
    ...params,
  });
  const url =
    method === 'GET' ? `${GRAPH_BASE}${path}?${body.toString()}` : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    method,
    ...(method === 'POST'
      ? {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        }
      : {}),
  });
  return (await parseApiResponse('FACEBOOK', res)) as T;
}

async function publishVideo(
  pageId: string,
  accessToken: string,
  videoUrl: string,
  description: string,
): Promise<string> {
  // file_url upload: the URL must be publicly reachable by Meta's servers.
  const data = await graph(pageId + '/videos', accessToken, {
    file_url: videoUrl,
    description,
  }, 'POST');
  if (!data.id) throw new PlatformApiError('FACEBOOK', 422, 'Video upload returned no id');
  return data.id;
}

async function publishImages(
  pageId: string,
  accessToken: string,
  imageUrls: string[],
  caption: string,
): Promise<string> {
  if (imageUrls.length === 1 && imageUrls[0]) {
    const data = await graph(pageId + '/photos', accessToken, {
      url: imageUrls[0],
      caption,
    }, 'POST');
    if (!data.id && !data.post_id) {
      throw new PlatformApiError('FACEBOOK', 422, 'Photo upload returned no id');
    }
    return data.post_id ?? data.id ?? '';
  }

  // Multi-photo post: upload each as unpublished, then attach to a feed post.
  const attached: Array<{ media_fbid: string }> = [];
  for (const url of imageUrls) {
    const uploaded = await graph(pageId + '/photos', accessToken, {
      url,
      published: 'false',
    }, 'POST');
    if (!uploaded.id) {
      throw new PlatformApiError('FACEBOOK', 422, `Photo upload failed for ${url}`);
    }
    attached.push({ media_fbid: uploaded.id });
  }
  const data = await graph(pageId + '/feed', accessToken, {
    message: caption,
    attached_media: JSON.stringify(attached),
  }, 'POST');
  if (!data.id) throw new PlatformApiError('FACEBOOK', 422, 'Feed post returned no id');
  return data.id;
}

export const facebookAdapter: PlatformAdapter = {
  platform: 'FACEBOOK',

  async publishPost(input: PublishPostInput): Promise<PublishPostResult> {
    const pageId = input.account.providerAccountId;
    // file_url uploads: Meta's servers fetch the media, so local uploads are
    // rewritten to their absolute public address (APP_URL).
    const urls = input.mediaUrls.map(toPublicMediaUrl);
    const category = input.category ?? 'post';
    const videos = urls.filter(isVideoUrl);
    const images = urls.filter(isImageUrl);

    let platformPostId: string;
    if (videos.length > 0 && videos[0] && category === 'reel') {
      const data = await graph(pageId + '/video_reels', input.accessToken, {
        file_url: videos[0],
        description: input.content,
      }, 'POST');
      if (!data.id) throw new PlatformApiError('FACEBOOK', 422, 'Reel upload returned no id');
      platformPostId = data.id;
    } else if (videos.length > 0 && videos[0]) {
      platformPostId = await publishVideo(pageId, input.accessToken, videos[0], input.content);
    } else if (images.length > 0) {
      platformPostId = await publishImages(pageId, input.accessToken, images, input.content);
    } else {
      const data = await graph(pageId + '/feed', input.accessToken, {
        message: input.content,
      }, 'POST');
      if (!data.id) throw new PlatformApiError('FACEBOOK', 422, 'Feed post returned no id');
      platformPostId = data.id;
    }

    return {
      platformPostId,
      url: `https://www.facebook.com/${platformPostId}`,
    };
  },

  async replyToComment(input: ReplyToCommentInput): Promise<ReplyToCommentResult> {
    const data = await graph(
      `/${input.commentExternalId}/comments`,
      input.accessToken,
      { message: input.replyText },
      'POST',
    );
    if (!data.id) throw new PlatformApiError('FACEBOOK', 422, 'Comment reply returned no id');
    return { replyId: data.id };
  },

  async getAnalytics(input: AnalyticsInput): Promise<AnalyticsResult> {
    const page = await graph(
      `/${input.providerAccountId}?fields=followers_count,fan_count`,
      input.accessToken,
    );
    const insights = await graph(
      `/${input.providerAccountId}/insights?metric=page_impressions,page_engaged_users&period=day&date_preset=last_28d`,
      input.accessToken,
    );

    let impressions = 0;
    let engagement = 0;
    for (const metric of insights.data ?? []) {
      const total = (metric.values ?? []).reduce(
        (sum, v) => sum + (typeof v.value === 'number' ? v.value : 0),
        0,
      );
      if (metric.name === 'page_impressions') impressions += total;
      if (metric.name === 'page_engaged_users') engagement += total;
    }

    return {
      followers: page.followers_count ?? page.fan_count ?? 0,
      engagement,
      impressions,
      clicks: {},
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
  }> {
    // Exchange a short-lived user token for a long-lived one.
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret) {
      throw new PlatformApiError(
        'FACEBOOK',
        500,
        'FACEBOOK_APP_ID / FACEBOOK_APP_SECRET are not configured',
      );
    }
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: refreshToken,
    });
    const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
    const data = (await parseApiResponse('FACEBOOK', res)) as GraphResponse;
    if (!data.access_token) {
      throw new PlatformApiError('FACEBOOK', 422, 'Token exchange returned no access token');
    }
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in ?? 5184000,
    };
  },
};
