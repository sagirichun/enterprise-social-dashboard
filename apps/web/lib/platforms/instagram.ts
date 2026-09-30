// Instagram (Meta Graph API — Instagram Content Publishing API) adapter.
// providerAccountId is the Instagram Business/Creator account ID (fetched via
// the instagram OAuth handler). The access token is the Meta user token with
// instagram_basic + instagram_content_publish scopes.

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

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface GraphEnvelope {
  id?: string;
  status_code?: string;
  followers_count?: number;
  media_count?: number;
  error?: { message?: string; code?: number; type?: string };
}

async function graph<T = GraphEnvelope>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  method: 'GET' | 'POST' = 'GET',
): Promise<T> {
  const body = new URLSearchParams({ ...params });
  body.set("access_token", accessToken); // set separately: never inline the token key
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
  return (await parseApiResponse('INSTAGRAM', res)) as T;
}

/** Create a media container; returns the container id. */
async function createContainer(
  igId: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<string> {
  const data = await graph(`/${igId}/media`, accessToken, params, 'POST');
  if (!data.id) {
    throw new PlatformApiError('INSTAGRAM', 422, 'Media container creation returned no id');
  }
  return data.id;
}

/** Wait until a video container finishes processing (up to ~5 minutes). */
async function waitForContainer(
  containerId: string,
  accessToken: string,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const data = await graph(`/${containerId}`, accessToken, {
      fields: 'status_code',
    });
    const status = data.status_code;
    if (status === 'FINISHED') return;
    if (status === 'ERROR') {
      throw new PlatformApiError('INSTAGRAM', 422, 'Instagram media processing failed');
    }
    await sleep(5000);
  }
  throw new PlatformApiError('INSTAGRAM', 504, 'Timed out waiting for Instagram media processing');
}

async function publishContainer(
  igId: string,
  accessToken: string,
  containerId: string,
): Promise<string> {
  const data = await graph(`/${igId}/media_publish`, accessToken, {
    creation_id: containerId,
  }, 'POST');
  if (!data.id) {
    throw new PlatformApiError('INSTAGRAM', 422, 'Media publish returned no id');
  }
  return data.id;
}

export const instagramAdapter: PlatformAdapter = {
  platform: 'INSTAGRAM',

  async publishPost(input: PublishPostInput): Promise<PublishPostResult> {
    const igId = input.account.providerAccountId;
    const token = input.accessToken;
    const category = input.category ?? 'post';
    const urls = input.mediaUrls.map(toPublicMediaUrl);
    const videos = urls.filter(isVideoUrl);
    const images = urls.filter(isImageUrl);
    const caption = input.content.slice(0, 2200);

    let containerId: string;

    if (category === 'story') {
      const media = videos[0] ?? images[0];
      if (!media) {
        throw new PlatformApiError('INSTAGRAM', 422, 'Stories require a photo or video');
      }
      const params: Record<string, string> = {
        media_type: 'STORIES',
        caption,
        ...(isVideoUrl(media) ? { video_url: media } : { image_url: media }),
      };
      containerId = await createContainer(igId, token, params);
      if (isVideoUrl(media)) await waitForContainer(containerId, token);
    } else if (category === 'reel') {
      const video = videos[0];
      if (!video) {
        throw new PlatformApiError('INSTAGRAM', 422, 'Reels require a video file');
      }
      const params: Record<string, string> = {
        media_type: 'REELS',
        video_url: video,
        caption,
        share_to_feed: 'true',
      };
      if (input.thumbnailUrl) {
        params.thumbnail_url = toPublicMediaUrl(input.thumbnailUrl);
      }
      containerId = await createContainer(igId, token, params);
      await waitForContainer(containerId, token);
    } else if (images.length > 1 && videos.length === 0) {
      // Carousel post: one unpublished child container per image.
      const children: string[] = [];
      for (const img of images.slice(0, 10)) {
        children.push(
          await createContainer(igId, token, {
            image_url: img,
            is_carousel_item: 'true',
          }),
        );
      }
      containerId = await createContainer(igId, token, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption,
      });
    } else if (videos[0]) {
      containerId = await createContainer(igId, token, {
        video_url: videos[0],
        caption,
        ...(input.thumbnailUrl
          ? { thumb_offset: '0' }
          : {}),
      });
      await waitForContainer(containerId, token);
    } else if (images[0]) {
      containerId = await createContainer(igId, token, {
        image_url: images[0],
        caption,
      });
    } else {
      throw new PlatformApiError(
        'INSTAGRAM',
        422,
        'Instagram posts require at least one photo or video — text-only posts are not supported',
      );
    }

    const mediaId = await publishContainer(igId, token, containerId);
    return {
      platformPostId: mediaId,
      url: `https://www.instagram.com/p/${mediaId}`,
    };
  },

  async replyToComment(input: ReplyToCommentInput): Promise<ReplyToCommentResult> {
    const data = await graph(
      `/${input.commentExternalId}/replies`,
      input.accessToken,
      { message: input.replyText },
      'POST',
    );
    return { replyId: data.id ?? input.commentExternalId };
  },

  async getAnalytics(input: AnalyticsInput): Promise<AnalyticsResult> {
    const data = await graph(`/${input.providerAccountId}`, input.accessToken, {
      fields: 'followers_count,media_count',
    });
    return {
      followers: data.followers_count ?? 0,
      engagement: 0,
      impressions: 0,
      clicks: { media: data.media_count ?? 0 },
    };
  },
};
