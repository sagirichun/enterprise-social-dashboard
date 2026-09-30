// X (Twitter) API v2 adapter.
// providerAccountId is the X user id. The access token must be an OAuth 2.0
// user-context token with tweet.read / tweet.write / users.read / offline.access.

import {
  PlatformApiError,
  downloadMedia,
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

const API_V2 = 'https://api.twitter.com/2';
const UPLOAD_V1 = 'https://upload.twitter.com/1.1/media/upload.json';

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Chunked media upload (INIT / APPEND / FINALIZE), with STATUS polling for
 * videos. Works with OAuth 2.0 user-context bearer tokens.
 */
async function uploadMedia(
  accessToken: string,
  mediaUrl: string,
): Promise<string> {
  const media = await downloadMedia(mediaUrl);
  const isVideo = media.contentType.startsWith('video/') || isVideoUrl(mediaUrl);
  const mediaType = media.contentType.startsWith('video/') ||
    media.contentType.startsWith('image/')
    ? media.contentType
    : isVideo
      ? 'video/mp4'
      : 'image/jpeg';

  // INIT
  const initParams = new URLSearchParams({
    command: 'INIT',
    total_bytes: String(media.sizeBytes),
    media_type: mediaType,
    media_category: isVideo ? 'tweet_video' : 'tweet_image',
  });
  let res = await fetch(UPLOAD_V1, {
    method: 'POST',
    headers: {
      ...bearer(accessToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: initParams.toString(),
  });
  let data = (await parseApiResponse('X', res)) as {
    media_id_string?: string;
    processing_info?: { state?: string; check_after_secs?: number; error?: { message?: string } };
  };
  const mediaId = data.media_id_string;
  if (!mediaId) throw new PlatformApiError('X', 422, 'Media INIT returned no media id');

  // APPEND in 5 MB base64 chunks.
  const CHUNK_BYTES = 5 * 1024 * 1024;
  let segmentIndex = 0;
  for (let offset = 0; offset < media.sizeBytes; offset += CHUNK_BYTES) {
    const chunk = media.buffer.subarray(offset, offset + CHUNK_BYTES);
    const form = new FormData();
    form.append('command', 'APPEND');
    form.append('media_id', mediaId);
    form.append('segment_index', String(segmentIndex));
    form.append('media_data', chunk.toString('base64'));
    res = await fetch(UPLOAD_V1, {
      method: 'POST',
      headers: bearer(accessToken),
      body: form,
    });
    if (res.status !== 204) {
      await parseApiResponse('X', res);
    }
    segmentIndex += 1;
  }

  // FINALIZE
  const finalizeParams = new URLSearchParams({
    command: 'FINALIZE',
    media_id: mediaId,
  });
  res = await fetch(UPLOAD_V1, {
    method: 'POST',
    headers: {
      ...bearer(accessToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: finalizeParams.toString(),
  });
  data = (await parseApiResponse('X', res)) as typeof data;

  // STATUS polling for async video processing.
  let processingInfo = data.processing_info;
  for (let attempt = 0; attempt < 60 && processingInfo; attempt += 1) {
    if (processingInfo.state === 'succeeded') break;
    if (processingInfo.state === 'failed') {
      throw new PlatformApiError(
        'X',
        422,
        `X media processing failed: ${processingInfo.error?.message ?? 'unknown error'}`,
      );
    }
    await sleep((processingInfo.check_after_secs ?? 5) * 1000);
    const statusParams = new URLSearchParams({
      command: 'STATUS',
      media_id: mediaId,
    });
    res = await fetch(UPLOAD_V1, {
      method: 'POST',
      headers: {
        ...bearer(accessToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: statusParams.toString(),
    });
    data = (await parseApiResponse('X', res)) as typeof data;
    processingInfo = data.processing_info;
  }

  return mediaId;
}

async function postTweet(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await fetch(`${API_V2}/tweets`, {
    method: 'POST',
    headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await parseApiResponse('X', res)) as {
    data?: { id?: string };
    errors?: Array<{ detail?: string; title?: string }>;
  };
  if (data.errors?.length) {
    throw new PlatformApiError(
      'X',
      422,
      data.errors.map((e) => e.detail ?? e.title).join('; ') || 'Tweet failed',
    );
  }
  const id = data.data?.id;
  if (!id) throw new PlatformApiError('X', 422, 'Tweet creation returned no id');
  return { id };
}

export const xAdapter: PlatformAdapter = {
  platform: 'X',

  async publishPost(input: PublishPostInput): Promise<PublishPostResult> {
    const mediaIds: string[] = [];
    for (const url of input.mediaUrls.slice(0, 4)) {
      if (isImageUrl(url) || isVideoUrl(url)) {
        mediaIds.push(await uploadMedia(input.accessToken, url));
      }
    }

    const body: Record<string, unknown> = {
      text: input.content.slice(0, 280),
    };
    if (mediaIds.length > 0) {
      body.media = { media_ids: mediaIds };
    }

    const { id } = await postTweet(input.accessToken, body);
    return {
      platformPostId: id,
      url: `https://x.com/i/status/${id}`,
    };
  },

  async replyToComment(input: ReplyToCommentInput): Promise<ReplyToCommentResult> {
    const { id } = await postTweet(input.accessToken, {
      text: input.replyText.slice(0, 280),
      reply: { in_reply_to_tweet_id: input.commentExternalId },
    });
    return { replyId: id };
  },

  async getAnalytics(input: AnalyticsInput): Promise<AnalyticsResult> {
    const params = new URLSearchParams({
      'user.fields': 'public_metrics',
    });
    const res = await fetch(
      `${API_V2}/users/${encodeURIComponent(input.providerAccountId)}?${params.toString()}`,
      { headers: bearer(input.accessToken) },
    );
    const data = (await parseApiResponse('X', res)) as {
      data?: {
        public_metrics?: {
          followers_count?: number;
          tweet_count?: number;
          like_count?: number;
        };
      };
    };
    const metrics = data.data?.public_metrics;
    return {
      followers: metrics?.followers_count ?? 0,
      engagement: metrics?.like_count ?? 0,
      impressions: 0,
      clicks: { tweets: metrics?.tweet_count ?? 0 },
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
  }> {
    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    if (!clientId) {
      throw new PlatformApiError('X', 500, 'TWITTER_CLIENT_ID is not configured');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      ...(clientSecret ? {} : { client_id: clientId }),
    });
    const res = await fetch(`${API_V2}/oauth2/token`, {
      method: 'POST',
      headers,
      body: body.toString(),
    });
    const data = (await parseApiResponse('X', res)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new PlatformApiError('X', 422, 'Token refresh returned no access token');
    }
    return {
      accessToken: data.access_token,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      expiresIn: data.expires_in ?? 7200,
    };
  },
};
