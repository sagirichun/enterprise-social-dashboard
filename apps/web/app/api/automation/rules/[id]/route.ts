import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../../../lib/auth';
import { db } from '../../../../../lib/db';
import { updateRuleSchema } from '../../../../../lib/validators';

interface RouteParams {
  params: { id: string };
}

async function findRule(userId: string, id: string) {
  return db.autoReplyRule.findFirst({ where: { id, userId } });
}

/** Update an auto-reply rule (e.g. toggle isEnabled). PATCH /api/automation/rules/[id] */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const rule = await findRule(user.id, params.id);
  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = updateRuleSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // exactOptionalPropertyTypes: only include keys that were actually provided.
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) data[k] = v;
  }

  const updated = await db.autoReplyRule.update({
    where: { id: rule.id },
    data,
  });
  return NextResponse.json({ rule: updated });
}

/** Delete an auto-reply rule. DELETE /api/automation/rules/[id] */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const rule = await findRule(user.id, params.id);
  if (!rule) {
    return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  }

  await db.autoReplyRule.delete({ where: { id: rule.id } });
  return NextResponse.json({ ok: true });
}
