import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { encrypt } from '../../../../lib/encryption';
import { getActiveEndpoint, redactEndpoint } from '../../../../lib/ai-config';

const providerEnum = z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'LMSTUDIO', 'CUSTOM']);
const REQUIRES_BASE_URL = ['OLLAMA', 'LMSTUDIO', 'CUSTOM'] as const;

const endpointSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(80),
    provider: providerEnum,
    model: z.string().min(1, 'Model is required').max(120),
    baseUrl: z.string().max(500).optional(),
    apiKey: z.string().max(4000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).max(32000).optional(),
    systemPrompt: z.string().max(4000).optional(),
  })
  .superRefine((data, ctx) => {
    const needsBase = (REQUIRES_BASE_URL as readonly string[]).includes(data.provider);
    if (needsBase && !data.baseUrl?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message: 'Base URL is required for this provider.',
      });
    }
  });

/** List the user's AI endpoints (API keys redacted). */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  // Triggers the legacy AiConfig auto-migration so it shows up immediately.
  await getActiveEndpoint(user.id);

  const endpoints = await db.aiEndpoint.findMany({
    where: { userId: user.id },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json({ endpoints: endpoints.map(redactEndpoint) });
}

/** Create an AI endpoint. The first one becomes active automatically. */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = endpointSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const existingCount = await db.aiEndpoint.count({ where: { userId: user.id } });

  const created = await db.aiEndpoint.create({
    data: {
      userId: user.id,
      name: d.name.trim(),
      provider: d.provider,
      model: d.model.trim(),
      baseUrl: d.baseUrl?.trim() || null,
      apiKeyEncrypted: d.apiKey?.trim() ? encrypt(d.apiKey.trim()) : null,
      temperature: d.temperature ?? 0.7,
      maxTokens: d.maxTokens ?? 800,
      systemPrompt: d.systemPrompt?.trim() || null,
      isActive: existingCount === 0,
    },
  });
  return NextResponse.json({ endpoint: redactEndpoint(created) }, { status: 201 });
}
