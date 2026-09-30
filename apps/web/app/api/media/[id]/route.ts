import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { deleteStoredFile } from '../../../../lib/media-store';

/** Delete a media asset (removes the DB row and the file on disk). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const asset = await db.mediaAsset.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!asset) {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 });
  }

  await db.mediaAsset.delete({ where: { id: asset.id } });
  await deleteStoredFile(asset.fileName);

  return NextResponse.json({ ok: true });
}
