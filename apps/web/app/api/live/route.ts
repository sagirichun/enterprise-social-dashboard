import { NextRequest, NextResponse } from 'next/server';
import type { LiveStream } from '@dashboard/db';
import { getAuthUser, unauthorized } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { encrypt } from '../../../lib/encryption';
import { createLiveStreamSchema } from '../../../lib/validators';
import { streamingStatus } from '../../../lib/streaming';

function sanitizeStream(stream: LiveStream) {
  const { rtmpKey: _k, ...rest } = stream;
  void _k;
  return { ...rest, hasRtmpKey: Boolean(stream.rtmpKey) };
}

/** List the current user's live stream configurations. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const streams = await db.liveStream.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  // Enrich LIVE streams with the engine's live status (best effort).
  const enriched = await Promise.all(
    streams.map(async (stream) => {
      const base = sanitizeStream(stream);
      if (stream.status !== 'LIVE') return { ...base, engine: null };
      try {
        const engine = await streamingStatus(stream.id);
        return { ...base, engine };
      } catch {
        return { ...base, engine: null };
      }
    }),
  );

  return NextResponse.json({ streams: enriched });
}

/** Create a live stream configuration (looped video -> RTMP). */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createLiveStreamSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const stream = await db.liveStream.create({
    data: {
      userId: user.id,
      title: data.title,
      description: data.description ?? null,
      videoUrl: data.videoUrl,
      rtmpUrl: data.rtmpUrl,
      rtmpKey: encrypt(data.rtmpKey),
      platform: data.platform,
      loop: data.loop,
      thumbnailUrl: data.thumbnailUrl ?? null,
      status: 'IDLE',
    },
  });

  return NextResponse.json({ stream: sanitizeStream(stream) }, { status: 201 });
}
