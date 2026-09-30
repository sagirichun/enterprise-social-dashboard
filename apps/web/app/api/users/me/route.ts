import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';

const updateMeSchema = z.object({
  name: z.string().min(1).max(120),
});

/** Current user profile. GET /api/users/me */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      createdAt: user.createdAt,
    },
  });
}

/** Update the current user's profile. PATCH /api/users/me */
export async function PATCH(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = updateMeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { name: parsed.data.name },
    select: { id: true, email: true, name: true, plan: true },
  });
  return NextResponse.json({ user: updated });
}

/**
 * Delete the current user and ALL of their data (accounts, posts, rules,
 * streams, comments, analytics, AI config). DELETE /api/users/me
 */
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  await db.user.delete({ where: { id: user.id } });
  return NextResponse.json({ ok: true });
}
