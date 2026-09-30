import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UnifiedAiClient, AiError, type ImageAspect } from '@dashboard/ai';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { getActiveEndpoint, getAiClientConfigFromEndpoint } from '../../../../lib/ai-config';
import { storeBuffer } from '../../../../lib/media-store';

const thumbnailSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required').max(1000),
  aspect: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  endpointId: z.string().min(1).optional(),
});

/**
 * Generate an AI thumbnail image.
 * Body: { prompt, aspect: "16:9" | "9:16" | "1:1", endpointId? }
 * Saves the image via the media store, tracks it as a MediaAsset, and
 * returns { url, mediaId, width, height }. Returns 422 when the provider
 * cannot generate images (text-only model / provider).
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
  const parsed = thumbnailSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { prompt, aspect, endpointId } = parsed.data;

  const endpoint = endpointId
    ? await db.aiEndpoint.findFirst({ where: { id: endpointId, userId: user.id } })
    : await getActiveEndpoint(user.id);
  if (!endpoint) {
    return NextResponse.json(
      {
        error: 'No AI endpoint configured',
        hint: 'Add an AI endpoint in AI Studio first.',
      },
      { status: 422 },
    );
  }

  let config;
  try {
    config = getAiClientConfigFromEndpoint(endpoint);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not decrypt the stored API key: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const client = new UnifiedAiClient(config);
  try {
    const image = await client.generateImage(prompt.trim(), aspect as ImageAspect);
    const stored = await storeBuffer(image.buffer, 'ai-thumbnail', image.mimeType);
    const asset = await db.mediaAsset.create({
      data: {
        userId: user.id,
        fileName: stored.fileName,
        originalName: 'ai-thumbnail',
        mimeType: stored.mimeType,
        size: stored.size,
        width: image.width,
        height: image.height,
        url: stored.url,
      },
    });
    return NextResponse.json({
      url: stored.url,
      mediaId: asset.id,
      width: image.width,
      height: image.height,
    });
  } catch (err) {
    if (err instanceof AiError && (err.statusCode === 404 || /not support/i.test(err.message))) {
      return NextResponse.json(
        {
          error: err.message,
          hint: 'Image generation needs an OpenAI-compatible endpoint with an image-capable model (e.g. dall-e-3).',
        },
        { status: 422 },
      );
    }
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: `AI provider error: ${err.message}` },
        { status: err.statusCode && err.statusCode < 500 ? 502 : 503 },
      );
    }
    return NextResponse.json(
      { error: `Thumbnail generation failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
