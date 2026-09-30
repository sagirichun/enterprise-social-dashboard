import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../../../lib/auth';
import { db } from '../../../../../lib/db';
import { decrypt } from '../../../../../lib/encryption';
import {
  streamingStart,
  StreamingServiceError,
} from '../../../../../lib/streaming';

interface RouteParams {
  params: { id: string };
}

/**
 * Start a 24/7 looped live stream.
 * Marks the stream LIVE in the database, then hands it to the streaming
 * engine (packages/streaming) which runs FFmpeg -> RTMP with auto-restart.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const stream = await db.liveStream.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!stream) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
  }
  if (stream.status === 'LIVE') {
    return NextResponse.json({
      stream: { ...stream, rtmpKey: undefined, hasRtmpKey: true },
      alreadyLive: true,
    });
  }

  const updated = await db.liveStream.update({
    where: { id: stream.id },
    data: {
      status: 'LIVE',
      startedAt: new Date(),
      endedAt: null,
      errorMessage: null,
    },
  });

  try {
    const engineStatus = await streamingStart({
      id: stream.id,
      name: stream.title,
      videoPath: stream.videoUrl,
      rtmpUrl: stream.rtmpUrl,
      streamKey: decrypt(stream.rtmpKey),
      loop: stream.loop,
      enabled: true,
    });

    const { rtmpKey: _k, ...sanitized } = updated;
    void _k;
    return NextResponse.json({
      stream: { ...sanitized, hasRtmpKey: true },
      engine: engineStatus,
    });
  } catch (err) {
    const message =
      err instanceof StreamingServiceError
        ? err.message
        : (err as Error).message;

    await db.liveStream.update({
      where: { id: stream.id },
      data: { status: 'ERROR', errorMessage: message.slice(0, 2000) },
    });

    return NextResponse.json(
      { error: 'Streaming engine failed to start the stream', details: message },
      { status: 502 },
    );
  }
}
