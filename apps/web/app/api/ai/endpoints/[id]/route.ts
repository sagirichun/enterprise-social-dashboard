import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser, unauthorized } from '../../../../../lib/auth';
import { db } from '../../../../../lib/db';
import { encrypt } from '../../../../../lib/encryption';
import { redactEndpoint } from '../../../../../lib/ai-config';

const providerEnum = z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'LMSTUDIO', 'CUSTOM']);
const REQUIRES_BASE_URL = ['OLLAMA', 'LMSTUDIO', 'CUSTOM'] as const;

const endpointObject = z.object({
    name: z.string().min(1, 'Name is required').max(80),
    provider: providerEnum,
    model: z.string().min(1, 'Model is required').max(120),
    baseUrl: z.string().max(500).optional(),
    apiKey: z.string().max(4000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(32000).optional(),
    systemPrompt: z.string().max(4000).optional(),
  });

const endpointSchema = endpointObject.superRefine((data, ctx) => {
    const needsBase = (REQUIRES_BASE_URL as readonly string[]).includes(data.provider);
    if (needsBase && !data.baseUrl?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'Base URL is required for this provider.',
      });
    }
  });

const patchSchema = endpointObject
  .partial()
  .extend({ isActive: z.literal(true).optional() });

async function getEndpoint(userId: string, id: string) {
  return db.aiEndpoint.findFirst({ where: { id, userId } });
}

/**
 * Update an endpoint. Pass { isActive: true } to switch the active endpoint
 * (all others are deactivated). Other fields are validated as a full object
 * merged over the current row. apiKey: non-empty string replaces, empty
 * string clears, omitted keeps.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const endpoint = await getEndpoint(user.id, params.id);
  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  // Switching the active endpoint: single write, no other field changes.
  if (d.isActive === true) {
    const [activated] = await db.$transaction([
      db.aiEndpoint.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false },
      }),
      db.aiEndpoint.update({ where: { id: endpoint.id }, data: { isActive: true } }),
    ]);
    void activated;
    const fresh = await getEndpoint(user.id, endpoint.id);
    return NextResponse.json({ endpoint: fresh ? redactEndpoint(fresh) : null });
  }

  // Merge patch over the current row and validate the full object.
  const merged = {
    name: d.name ?? endpoint.name,
    provider: d.provider ?? endpoint.provider,
    model: d.model ?? endpoint.model,
    baseUrl: d.baseUrl !== undefined ? d.baseUrl : (endpoint.baseUrl ?? undefined),
    temperature: d.temperature ?? endpoint.temperature,
    maxTokens: d.maxTokens ?? endpoint.maxTokens,
    systemPrompt: d.systemPrompt !== undefined ? d.systemPrompt : (endpoint.systemPrompt ?? undefined),
  };
  const full = endpointSchema.safeParse(merged);
  if (!full.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: full.error.flatten() },
      { status: 400 },
    );
  }
  const f = full.data;

  const data: Record<string, unknown> = {
    name: f.name.trim(),
    provider: f.provider,
    model: f.model.trim(),
    baseUrl: f.baseUrl?.trim() || null,
    temperature: f.temperature ?? endpoint.temperature,
    maxTokens: f.maxTokens ?? endpoint.maxTokens,
    systemPrompt: f.systemPrompt?.trim() || null,
    // A config change invalidates the last check result.
    lastCheckAt: null,
    lastCheckOk: null,
    lastCheckError: null,
  };
  if (d.apiKey !== undefined) {
    data.apiKeyEncrypted = d.apiKey.trim() ? encrypt(d.apiKey.trim()) : null;
  }

  const updated = await db.aiEndpoint.update({
    where: { id: endpoint.id },
    data: data as never,
  });
  return NextResponse.json({ endpoint: redactEndpoint(updated) });
}

/**
 * Delete an endpoint. Refuses when it is the user's only endpoint; when the
 * active one is deleted, the newest remaining endpoint becomes active.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const endpoint = await getEndpoint(user.id, params.id);
  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  }

  const count = await db.aiEndpoint.count({ where: { userId: user.id } });
  if (count <= 1) {
    return NextResponse.json(
      { error: 'Cannot delete the only AI endpoint. Add another one first.' },
      { status: 409 },
    );
  }

  await db.$transaction(async (tx) => {
    await tx.aiEndpoint.delete({ where: { id: endpoint.id } });
    if (endpoint.isActive) {
      const next = await tx.aiEndpoint.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      if (next) {
        await tx.aiEndpoint.update({
          where: { id: next.id },
          data: { isActive: true },
        });
      }
    }
  });
  return NextResponse.json({ ok: true });
}
