import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UnifiedAiClient } from '@dashboard/ai';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { db } from '../../../../lib/db';
import { getAiClientConfigFromEndpoint } from '../../../../lib/ai-config';

const testBodySchema = z.object({
  endpointId: z.string().min(1),
});

/**
 * Run a real connection check against one of the user's AI endpoints.
 * Returns the full diagnostic report (steps with timings) and persists the
 * result on the endpoint row. testConnection never throws, so the report
 * always has an `ok` flag and an actionable error message.
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
  const parsed = testBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const endpoint = await db.aiEndpoint.findFirst({
    where: { id: parsed.data.endpointId, userId: user.id },
  });
  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  }

  let config;
  try {
    config = getAiClientConfigFromEndpoint(endpoint);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not decrypt the stored API key: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const client = new UnifiedAiClient(config);
  const report = await client.testConnection();

  await db.aiEndpoint.update({
    where: { id: endpoint.id },
    data: {
      lastCheckAt: new Date(),
      lastCheckOk: report.ok,
      lastCheckError: report.error ?? null,
    },
  });

  return NextResponse.json(report);
}
