// YouTube (YouTube Data API v3 + YouTube Analytics API) adapter.
// providerAccountId is the YouTube channel ID. Requires OAuth scopes:
// youtube.upload and youtube.force-ssl. Only video posts are supported
// (the Data API does not expose community/text posts).

import {
  PlatformApiError,
  downloadMedia,
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

const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_BASE = 'https://youtubeanalytics.googleapis.com/v2';

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

async function uploadVideo(
  accessToken: string,
  videoUrl: string,
  title: string,
  description: string,
): Promise<string> {
  const media = await downloadMedia(videoUrl);
  const mimeType = media.contentType.startsWith('video/')
    ? media.contentType
    : 'video/mp4';

  // Step 1: initiate a resumable upload session.
  const initRes = await fetch(
    `${UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(media.sizeBytes),
      },
      body: JSON.stringify({
        snippet: {
          title: title.slice(0, 100) || 'Untitled video',
          description: description.slice(0, 5000),
          categoryId: '22',
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );
  if (!initRes.ok) {
    await parseApiResponse('YOUTUBE', initRes);
  }
  const sessionUri = initRes.headers.get('location');
  if (!sessionUri) {
    throw new PlatformApiError('YOUTUBE', 422, 'Resumable upload returned no session URI');
  }

  // Step 2: upload the bytes.
  const putRes = await fetch(sessionUri, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(media.sizeBytes),
    },
    body: new Blob([new Uint8Array(media.buffer)], { type: mimeType }),
  });
  const data = (await parseApiResponse('YOUTUBE', putRes)) as { id?: string };
  if (!data.id) {
    throw new PlatformApiError('YOUTUBE', 422, 'YouTube upload returned no video id');
  }
  return data.id;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const youtubeAdapter: PlatformAdapter = {
  platform: 'YOUTUBE',

  async publishPost(input: PublishPostInput): Promise<PublishPostResult> {
    const videos = input.mediaUrls.filter(isVideoUrl);
    if (videos.length === 0 || !videos[0]) {
      throw new PlatformApiError(
        'YOUTUBE',
        422,
        'YouTube publishing requires at least one video file; text/image-only posts are not supported by the YouTube Data API',
      );
    }
    const title = input.content.split('\n')[0]?.slice(0, 100) ?? 'Untitled video';
    const videoId = await uploadVideo(input.accessToken, videos[0], title, input.content);

    // Optional thumbnail: upload bytes straight to YouTube (works for local
    // media-library files too). Non-fatal — the video stays published if it
    // fails, and the error is surfaced in the worker logs.
    if (input.thumbnailUrl) {
      try {
        const thumb = await downloadMedia(input.thumbnailUrl, 8 * 1024 * 1024);
        if (!thumb.contentType.startsWith('image/')) {
          throw new Error(`Thumbnail must be an image, got ${thumb.contentType}`);
        }
        const res = await fetch(
          `${UPLOAD_BASE}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
          {
            method: 'POST',
            headers: {
              ...authHeaders(input.accessToken),
              'Content-Type': thumb.contentType,
              'Content-Length': String(thumb.sizeBytes),
            },
            body: thumb.buffer as unknown as BodyInit,
          },
        );
        await parseApiResponse('YOUTUBE', res);
      } catch (err) {
        console.warn(
          `[youtube] thumbnail upload failed for video ${videoId}: ${(err as Error).message}`,
        );
      }
    }

    return {
      platformPostId: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  },

  async replyToComment(input: ReplyToCommentInput): Promise<ReplyToCommentResult> {
    const res = await fetch(`${API_BASE}/comments?part=snippet`, {
      method: 'POST',
      headers: {
        ...authHeaders(input.accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          parentId: input.commentExternalId,
          textOriginal: input.replyText,
        },
      }),
    });
    const data = (await parseApiResponse('YOUTUBE', res)) as { id?: string };
    if (!data.id) throw new PlatformApiError('YOUTUBE', 422, 'Comment reply returned no id');
    return { replyId: data.id };
  },

  async getAnalytics(input: AnalyticsInput): Promise<AnalyticsResult> {
    const headers = authHeaders(input.accessToken);

    const channelRes = await fetch(
      `${API_BASE}/channels?part=statistics&id=${encodeURIComponent(input.providerAccountId)}`,
      { headers },
    );
    const channel = (await parseApiResponse('YOUTUBE', channelRes)) as {
      items?: Array<{ statistics?: { subscriberCount?: string } }>;
    };
    const followers = Number(
      channel.items?.[0]?.statistics?.subscriberCount ?? 0,
    );

    const until = input.until ?? new Date();
    const since = input.since ?? new Date(until.getTime() - 28 * 24 * 3600 * 1000);
    const reportRes = await fetch(
      `${ANALYTICS_BASE}/reports?ids=channel==${encodeURIComponent(input.providerAccountId)}` +
        `&startDate=${toISODate(since)}&endDate=${toISODate(until)}` +
        `&metrics=views,likes,comments,shares,estimatedMinutesWatched`,
      { headers },
    );
    const report = (await parseApiResponse('YOUTUBE', reportRes)) as {
      rows?: number[][];
    };
    const totals = (report.rows ?? []).reduce(
      (acc, row) => ({
        views: acc.views + (row[0] ?? 0),
        likes: acc.likes + (row[1] ?? 0),
        comments: acc.comments + (row[2] ?? 0),
        shares: acc.shares + (row[3] ?? 0),
        watchMinutes: acc.watchMinutes + (row[4] ?? 0),
      }),
      { views: 0, likes: 0, comments: 0, shares: 0, watchMinutes: 0 },
    );

    return {
      followers,
      engagement: totals.likes + totals.comments + totals.shares,
      impressions: totals.views,
      clicks: { watchMinutes: Math.round(totals.watchMinutes) },
    };
  },

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
  }> {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.YOUTUBE_CLIENT_ID;
    const clientSecret =
      process.env.GOOGLE_CLIENT_SECRET ?? process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new PlatformApiError(
        'YOUTUBE',
        500,
        'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured',
      );
    }
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const data = (await parseApiResponse('YOUTUBE', res)) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new PlatformApiError('YOUTUBE', 422, 'Token refresh returned no access token');
    }
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in ?? 3600,
    };
  },
};
