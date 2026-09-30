// Loads a user's AI configuration from the database and converts it into
// the @dashboard/ai client config (decrypting the stored API key).
//
// Multi-endpoint model: users can register several named AiEndpoint rows
// (9Router, Ollama, OpenAI, ...), one of which is active. getAiClientConfig()
// — used by background workers — resolves the active endpoint, auto-migrating
// the legacy single AiConfig row on first use.

import { AiProvider, type AiConfig } from '@dashboard/ai';
import type { AiEndpoint } from '@prisma/client';
import { db } from './db';
import { decrypt } from './encryption';

const DB_PROVIDER_TO_AI_PROVIDER: Record<string, AiProvider> = {
  OPENAI: AiProvider.OPENAI,
  ANTHROPIC: AiProvider.ANTHROPIC,
  OLLAMA: AiProvider.OLLAMA,
  LMSTUDIO: AiProvider.LMSTUDIO,
  CUSTOM: AiProvider.CUSTOM,
};

/** Build an AiConfig from an AiEndpoint row (decrypts the stored API key). */
export function getAiClientConfigFromEndpoint(endpoint: AiEndpoint): AiConfig {
  // Conditional spreads keep explicit `undefined` out of the object, which
  // the web tsconfig's exactOptionalPropertyTypes requires.
  return {
    provider: DB_PROVIDER_TO_AI_PROVIDER[endpoint.provider] ?? AiProvider.OPENAI,
    model: endpoint.model,
    ...(endpoint.baseUrl ? { baseUrl: endpoint.baseUrl } : {}),
    ...(endpoint.apiKeyEncrypted ? { apiKey: decrypt(endpoint.apiKeyEncrypted) } : {}),
    temperature: endpoint.temperature,
    maxTokens: endpoint.maxTokens,
    ...(endpoint.systemPrompt ? { defaultSystemPrompt: endpoint.systemPrompt } : {}),
  };
}

/**
 * The user's active AI endpoint, or null when none is configured.
 *
 * Auto-migration: when the user has zero endpoints but a legacy AiConfig row
 * exists, it is converted into an endpoint named "Migrated config" (active)
 * and returned. When endpoints exist but none is marked active, the most
 * recently created one is activated as a safety net.
 */
export async function getActiveEndpoint(userId: string): Promise<AiEndpoint | null> {
  const active = await db.aiEndpoint.findFirst({
    where: { userId, isActive: true },
  });
  if (active) return active;

  const count = await db.aiEndpoint.count({ where: { userId } });
  if (count > 0) {
    // Safety net: activate the newest endpoint so the user never ends up
    // with endpoints but no usable one.
    const newest = await db.aiEndpoint.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!newest) return null;
    return db.aiEndpoint.update({
      where: { id: newest.id },
      data: { isActive: true },
    });
  }

  const legacy = await db.aiConfig.findUnique({ where: { userId } });
  if (!legacy) return null;
  return db.aiEndpoint.create({
    data: {
      userId,
      name: 'Migrated config',
      provider: legacy.provider,
      model: legacy.model,
      baseUrl: legacy.baseUrl,
      apiKeyEncrypted: legacy.apiKeyEncrypted,
      temperature: legacy.temperature,
      maxTokens: legacy.maxTokens,
      systemPrompt: legacy.systemPrompt,
      isActive: true,
    },
  });
}

export async function getAiClientConfig(
  userId: string,
): Promise<AiConfig | null> {
  const endpoint = await getActiveEndpoint(userId);
  if (endpoint) return getAiClientConfigFromEndpoint(endpoint);

  const record = await db.aiConfig.findUnique({ where: { userId } });
  if (!record) return null;

  // Conditional spreads keep explicit `undefined` out of the object, which
  // the web tsconfig's exactOptionalPropertyTypes requires.
  return {
    provider: DB_PROVIDER_TO_AI_PROVIDER[record.provider] ?? AiProvider.OPENAI,
    model: record.model,
    ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
    ...(record.apiKeyEncrypted
      ? { apiKey: decrypt(record.apiKeyEncrypted) }
      : {}),
    temperature: record.temperature,
    maxTokens: record.maxTokens,
    ...(record.systemPrompt ? { defaultSystemPrompt: record.systemPrompt } : {}),
  };
}

/** The stored config with the API key redacted (safe to send to the UI). */
export async function getAiConfigForUi(userId: string) {
  const record = await db.aiConfig.findUnique({ where: { userId } });
  if (!record) return null;
  const { apiKeyEncrypted: _redacted, ...rest } = record;
  void _redacted;
  return { ...rest, hasApiKey: Boolean(record.apiKeyEncrypted) };
}

/** An endpoint row with the API key redacted (safe to send to the UI). */
export function redactEndpoint(endpoint: AiEndpoint) {
  const { apiKeyEncrypted: _redacted, ...rest } = endpoint;
  void _redacted;
  return { ...rest, hasApiKey: Boolean(endpoint.apiKeyEncrypted) };
}
