import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { streamingStop } from '../../../../lib/streaming';

interface RouteParams {
  params: { id: string };
}

/** Delete a stream configuration. DELETE /api/live/[id] (only when not live). */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const stream = await db.liveStream.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true, status: true },
  });
  if (!stream) {
    return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
  }
  if (stream.status === 'LIVE') {
    try {
      await streamingStop(stream.id);
    } catch {
      /* best effort */
    }
  }

  await db.liveStream.delete({ where: { id: stream.id } });
  return NextResponse.json({ ok: true });
}
