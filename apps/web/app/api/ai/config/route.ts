import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { encrypt } from '../../../../lib/encryption';
import { aiConfigSchema } from '../../../../lib/validators';
import { getAiConfigForUi } from '../../../../lib/ai-config';

/** Get the current user's AI provider config (API key redacted). */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const config = await getAiConfigForUi(user.id);
  return NextResponse.json({ config });
}

/**
 * Create or update the current user's AI provider config.
 * The API key is encrypted at rest and never returned by the API.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = aiConfigSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const existing = await db.aiConfig.findUnique({
    where: { userId: user.id },
  });

  // Keep the existing key when the client sends null/empty (key redaction).
  const apiKeyEncrypted =
    data.apiKey && data.apiKey.length > 0
      ? encrypt(data.apiKey)
      : (existing?.apiKeyEncrypted ?? null);

  const config = await db.aiConfig.upsert({
    where: { userId: user.id },
    update: {
      provider: data.provider,
      model: data.model,
      baseUrl: data.baseUrl || null,
      apiKeyEncrypted,
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      systemPrompt: data.systemPrompt || null,
    },
    create: {
      userId: user.id,
      provider: data.provider,
      model: data.model,
      baseUrl: data.baseUrl || null,
      apiKeyEncrypted,
      temperature: data.temperature,
      maxTokens: data.maxTokens,
      systemPrompt: data.systemPrompt || null,
    },
  });

  const { apiKeyEncrypted: _redacted, ...rest } = config;
  void _redacted;

  return NextResponse.json({
    config: { ...rest, hasApiKey: Boolean(config.apiKeyEncrypted) },
  });
}
