import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../../../lib/auth';
import { db } from '../../../../../lib/db';
import {
  streamingStop,
  StreamingServiceError,
} from '../../../../../lib/streaming';

interface RouteParams {
  params: { id: string };
}

/** Stop a live stream: tell the streaming engine, then mark STOPPED. */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const stream = await db.liveStream.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!stream) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
  }

  let engineWarning: string | null = null;
  try {
    await streamingStop(stream.id);
  } catch (err) {
    // The engine may already have stopped/crashed; still mark STOPPED locally.
    engineWarning =
      err instanceof StreamingServiceError
        ? err.message
        : (err as Error).message;
  }

  const updated = await db.liveStream.update({
    where: { id: stream.id },
    data: {
      status: 'STOPPED',
      endedAt: new Date(),
      ...(engineWarning
        ? { errorMessage: `Engine stop warning: ${engineWarning}`.slice(0, 2000) }
        : {}),
    },
  });

  const { rtmpKey: _k, ...sanitized } = updated;
  void _k;

  return NextResponse.json({
    stream: { ...sanitized, hasRtmpKey: true },
    ...(engineWarning ? { engineWarning } : {}),
  });
}
