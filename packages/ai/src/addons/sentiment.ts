/**
 * Batch sentiment analysis.
 *
 * Sends texts to the model in chunks and parses the JSON array response,
 * falling back to per-text analysis if a batch response cannot be parsed.
 * Also provides an aggregate summary helper for dashboards.
 */

import type { UnifiedAiClient } from '../client';
import type { SentimentResult } from '../types';
import { normalizeSentiment } from '../types';
import {
  SENTIMENT_ANALYSIS_SYSTEM_PROMPT,
  buildSentimentBatchUserPrompt,
} from '../prompts';
import { extractJson } from '../json';

export interface BatchSentimentItem extends SentimentResult {
  index: number;
  text: string;
}

export interface SentimentBatchOptions {
  /** Number of texts per model request. Defaults to 10. */
  batchSize?: number;
  /** Max concurrent batch requests. Defaults to 3. */
  concurrency?: number;
}

export interface SentimentSummary {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  averageScore: number;
  /** Share of non-neutral items, 0..1. */
  polarityRate: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function analyzeBatch(
  client: UnifiedAiClient,
  batch: Array<{ text: string; index: number }>,
): Promise<BatchSentimentItem[]> {
  const result = await client.generateText(
    buildSentimentBatchUserPrompt(batch.map((b) => b.text)),
    { systemPrompt: SENTIMENT_ANALYSIS_SYSTEM_PROMPT, temperature: 0, maxTokens: 4000 },
  );
  const parsed = extractJson<Array<Partial<SentimentResult>>>(result.text);
  if (!Array.isArray(parsed) || parsed.length !== batch.length) {
    throw new Error(
      `Batch sentiment response length mismatch (expected ${batch.length}, got ${Array.isArray(parsed) ? parsed.length : 'non-array'})`,
    );
  }
  return batch.map((b, i) => ({ ...normalizeSentiment(parsed[i]), index: b.index, text: b.text }));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      if (item !== undefined) {
        results[i] = await fn(item);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Analyze sentiment for many texts efficiently.
 * Returns results in the same order as the input texts.
 */
export async function analyzeSentimentBatch(
  client: UnifiedAiClient,
  texts: string[],
  opts: SentimentBatchOptions = {},
): Promise<BatchSentimentItem[]> {
  const batchSize = Math.max(1, opts.batchSize ?? 10);
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const indexed = texts.map((text, index) => ({ text, index }));
  const batches = chunk(indexed, batchSize);

  const batchResults = await mapWithConcurrency(batches, concurrency, async (batch) => {
    try {
      return await analyzeBatch(client, batch);
    } catch {
      // Fallback: analyze each text individually so one bad batch
      // does not lose the whole chunk.
      return await mapWithConcurrency(
        batch,
        concurrency,
        async (b): Promise<BatchSentimentItem> => ({
          ...(await client.analyzeSentiment(b.text)),
          index: b.index,
          text: b.text,
        }),
      );
    }
  });

  return batchResults
    .flat()
    .sort((a, b) => a.index - b.index);
}

/** Aggregate per-label counts and average score for dashboard widgets. */
export function summarizeSentiment(items: SentimentResult[]): SentimentSummary {
  const total = items.length;
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  let scoreSum = 0;
  for (const item of items) {
    if (item.label === 'positive') positive++;
    else if (item.label === 'negative') negative++;
    else neutral++;
    scoreSum += item.score;
  }
  const nonNeutral = positive + negative;
  return {
    total,
    positive,
    neutral,
    negative,
    averageScore: total === 0 ? 0 : scoreSum / total,
    polarityRate: total === 0 ? 0 : nonNeutral / total,
  };
}
