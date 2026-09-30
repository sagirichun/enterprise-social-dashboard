import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../lib/auth';
import { db } from '../../../lib/db';
import { storeWebFile } from '../../../lib/media-store';

/** List the user's media assets, newest first. */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get('kind'); // "image" | "video" | null
  const pageSize = Math.min(
    Number(searchParams.get('pageSize') ?? '48') || 48,
    100,
  );

  const assets = await db.mediaAsset.findMany({
    where: {
      userId: user.id,
      ...(kind === 'image'
        ? { mimeType: { startsWith: 'image/' } }
        : kind === 'video'
          ? { mimeType: { startsWith: 'video/' } }
          : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: pageSize,
  });

  return NextResponse.json({ assets });
}

/**
 * Upload a media file (multipart form-data, field "file").
 * Images and videos up to 512 MB are stored on the server's disk.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart form-data with a "file" field' },
      { status: 400 },
    );
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'No file provided (field "file")' },
      { status: 400 },
    );
  }

  let stored;
  try {
    stored = await storeWebFile(file);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 422 },
    );
  }

  const asset = await db.mediaAsset.create({
    data: {
      userId: user.id,
      fileName: stored.fileName,
      originalName: file.name || stored.fileName,
      mimeType: stored.mimeType,
      size: stored.size,
      url: stored.url,
    },
  });

  return NextResponse.json({ asset }, { status: 201 });
}
