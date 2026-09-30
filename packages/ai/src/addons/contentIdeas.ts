/**
 * Trending content-ideas generator add-on.
 *
 * Produces structured, platform-aware ideas (title, hook, format, hashtags,
 * why-it-works) for a niche, with validation and sane defaults.
 */

import type { UnifiedAiClient } from '../client';
import {
  TRENDING_IDEAS_SYSTEM_PROMPT,
  buildTrendingIdeasUserPrompt,
  type TrendingIdeaRequest,
} from '../prompts';
import { extractJson } from '../json';

export interface TrendingIdea {
  title: string;
  hook: string;
  format: string;
  hashtags: string[];
  whyItWorks: string;
}

export type GenerateTrendingIdeasInput = TrendingIdeaRequest;

interface RawIdea {
  title?: unknown;
  hook?: unknown;
  format?: unknown;
  hashtags?: unknown;
  whyItWorks?: unknown;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function normalizeIdea(raw: RawIdea): TrendingIdea | null {
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) return null;
  return {
    title: raw.title.trim(),
    hook: typeof raw.hook === 'string' ? raw.hook.trim() : '',
    format: typeof raw.format === 'string' ? raw.format.trim() : 'video',
    hashtags: toStringArray(raw.hashtags).map((h) => (h.startsWith('#') ? h : `#${h}`)),
    whyItWorks: typeof raw.whyItWorks === 'string' ? raw.whyItWorks.trim() : '',
  };
}

/**
 * Generate trending content ideas for a niche.
 * Returns up to `count` validated ideas (defaults to 8).
 */
export async function generateTrendingIdeas(
  client: UnifiedAiClient,
  input: GenerateTrendingIdeasInput,
): Promise<TrendingIdea[]> {
  const count = input.count ?? 8;
  const result = await client.generateText(buildTrendingIdeasUserPrompt(input), {
    systemPrompt: TRENDING_IDEAS_SYSTEM_PROMPT,
    temperature: 0.9,
    maxTokens: 3000,
  });
  const parsed = extractJson<RawIdea[]>(result.text);
  if (!Array.isArray(parsed)) {
    throw new Error('Trending ideas response was not a JSON array');
  }
  return parsed
    .map(normalizeIdea)
    .filter((idea): idea is TrendingIdea => idea !== null)
    .slice(0, count);
}
