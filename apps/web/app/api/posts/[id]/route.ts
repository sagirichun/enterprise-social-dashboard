import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';

/**
 * Delete a post that has not been published yet.
 * DELETE /api/posts/[id]
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const post = await db.post.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true, status: true },
  });
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }
  if (['PUBLISHING', 'PUBLISHED'].includes(post.status)) {
    return NextResponse.json(
      { error: `Cannot delete a post with status ${post.status}` },
      { status: 409 }
    );
  }

  await db.post.delete({ where: { id: post.id } });
  return NextResponse.json({ ok: true });
}
