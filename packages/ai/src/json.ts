/**
 * Tolerant JSON extraction from AI model output.
 *
 * Models are instructed to return pure JSON, but in practice they often wrap it
 * in markdown fences or add surrounding prose. extractJson handles both cases.
 */

import { AiError } from './types';

/** Return the first balanced {...} or [...] substring, respecting strings. */
function sliceBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJson<T = unknown>(text: string): T {
  if (!text || !text.trim()) {
    throw new AiError('Empty AI response, expected JSON', 'parser');
  }
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) candidates.push(fence[1].trim());
  candidates.push(text.trim());

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // fall through to balanced slicing
    }
    const sliced = sliceBalanced(candidate);
    if (sliced) {
      try {
        return JSON.parse(sliced) as T;
      } catch {
        // try next candidate
      }
    }
  }
  throw new AiError(
    `Failed to parse JSON from AI response: ${text.slice(0, 200)}`,
    'parser',
  );
}
