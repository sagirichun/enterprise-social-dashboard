// TikTok (TikTok API v2) adapter.
// providerAccountId is the TikTok open_id. The access token needs the
// video.upload / video.publish scopes (and comment scopes for replies).

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

const API_BASE = 'https://open.tiktokapis.com/v2';

interface TikTokEnvelope<T = Record<string, unknown>> {
  error?: { code?: string; message?: string; log_id?: string };
  data?: T;
}

async function tiktok<T = Record<string, unknown>>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  });
  const data = (await parseApiResponse('TIKTOK', res)) as TikTokEnvelope<T>;
  if (data.error?.code && data.error.code !== 'ok') {
    throw new PlatformApiError(
      'TIKTOK',
      res.status,
      data.error.message ?? `TikTok error ${data.error.code}`,
      data.error.code,
    );
  }
  return (data.data ?? {}) as T;
}

async function waitForPublish(
  accessToken: string,
  publishId: string,
): Promise<void> {
  // Poll the publish status until it completes or fails (up to ~5 minutes).
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await tiktok<{ status: string; fail_reason?: string }>(
      '/post/publish/status/fetch/',
      accessToken,
      { publish_id: publishId },
    );
    if (status.status === 'PUBLISH_COMPLETE') return;
    if (status.status === 'FAILED') {
      throw new PlatformApiError(
        'TIKTOK',
        422,
        `TikTok publish failed: ${status.fail_reason ?? 'unknown reason'}`,
      );
    }
    await sleep(5000);
  }
  throw new PlatformApiError('TIKTOK', 504, 'Timed out waiting for TikTok publish');
}

export const tiktokAdapter: PlatformAdapter = {
  platform: 'TIKTOK',

  async publishPost(input: PublishPostInput): Promise<PublishPostResult> {
    // PULL_FROM_URL: TikTok fetches media from a public URL, so local
    // uploads are rewritten to their absolute public address (APP_URL).
    const urls = input.mediaUrls.map(toPublicMediaUrl);
    const category = input.category ?? 'video';
    const videos = urls.filter(isVideoUrl);
    const images = urls.filter(isImageUrl);

    const wantsPhotos = category === 'carousel' || (videos.length === 0 && images.length > 0);
    const wantsVideo = !wantsPhotos && videos.length > 0;

    if (wantsVideo && videos[0]) {
      // PULL_FROM_URL: TikTok fetches the video from our public URL.
      const init = await tiktok<{ publish_id: string }>(
        '/post/publish/video/init/',
        input.accessToken,
        {
          post_info: {
            title: input.content.slice(0, 2200),
            privacy_level: 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videos[0],
          },
        },
      );
      if (!init.publish_id) {
        throw new PlatformApiError('TIKTOK', 422, 'Video init returned no publish_id');
      }
      await waitForPublish(input.accessToken, init.publish_id);
      return { platformPostId: init.publish_id };
    }

    // Photo or text post via the content posting API.
    const isPhoto = images.length > 0;
    const init = await tiktok<{ publish_id: string }>(
      '/post/publish/content/init/',
      input.accessToken,
      {
        post_mode: 'DIRECT_POST',
        media_type: isPhoto ? 'PHOTO' : 'TEXT',
        post_info: {
          title: input.content.slice(0, 2200),
          description: input.content.slice(0, 2200),
          privacy_level: 'PUBLIC_TO_EVERYONE',
        },
        source_info: isPhoto
          ? {
              source: 'PULL_FROM_URL',
              photo_cover_index: 0,
              photo_images: images.slice(0, 35),
            }
          : undefined,
      },
    );
    if (!init.publish_id) {
      throw new PlatformApiError('TIKTOK', 422, 'Content init returned no publish_id');
    }
    await waitForPublish(input.accessToken, init.publish_id);
    return { platformPostId: init.publish_id };
  },

  async replyToComment(input: ReplyToCommentInput): Promise<ReplyToCommentResult> {
    if (!input.parentExternalId) {
      throw new PlatformApiError(
        'TIKTOK',
        422,
        'TikTok comment replies require the parent video id (parentExternalId)',
      );
    }
    const result = await tiktok<{ comment_id: string }>(
      '/comment/reply/create/',
      input.accessToken,
      {
        video_id: input.parentExternalId,
        comment_id: input.commentExternalId,
        text: input.replyText.slice(0, 150),
      },
    );
    return { replyId: result.comment_id ?? input.commentExternalId };
  },

  async getAnalytics(input: AnalyticsInput): Promise<AnalyticsResult> {
    const user = await tiktok<{
      follower_count?: number;
      likes_count?: number;
      video_count?: number;
    }>(
      '/user/info/',
      input.accessToken,
      {
        fields: ['follower_count', 'following_count', 'likes_count', 'video_count'],
      },
    );
    return {
      followers: user.follower_count ?? 0,
      engagement: user.likes_count ?? 0,
      impressions: 0,
      clicks: { videos: user.video_count ?? 0 },
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
  }> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      throw new PlatformApiError(
        'TIKTOK',
        500,
        'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not configured',
      );
    }
    const res = await fetch(`${API_BASE}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    const data = (await parseApiResponse('TIKTOK', res)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new PlatformApiError('TIKTOK', 422, 'Token refresh returned no access token');
    }
    return {
      accessToken: data.access_token,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      expiresIn: data.expires_in ?? 86400,
    };
  },
};
