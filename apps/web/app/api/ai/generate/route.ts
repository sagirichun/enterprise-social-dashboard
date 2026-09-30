import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  UnifiedAiClient,
  AiError,
  CONTENT_GENERATION_SYSTEM_PROMPT,
  buildRewriteUserPrompt,
} from '@dashboard/ai';
import { getAuthUser, unauthorized } from '../../../../lib/auth';
import { getAiClientConfig } from '../../../../lib/ai-config';
import { generateContentSchema } from '../../../../lib/validators';

// validators.ts is shared/frozen; the optional language override is added here.
const generateSchema = generateContentSchema.extend({
  language: z.string().min(1).max(60).optional(),
});

/**
 * AI content generation.
 *
 * Body: { type: "post" | "caption" | "reply" | "hashtags" | "rewrite" | "ideas",
 *         prompt, platform?, tone?, count?, language? }
 *
 * `language` (e.g. "Indonesian", "English", or any free text) is injected as
 * "Respond in <language>." into every generation prompt.
 *
 * Uses the user's active AI endpoint (auto-migrated from the legacy config).
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

  const parsed = generateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { type, prompt, platform, tone, count, language } = parsed.data;

  const aiConfig = await getAiClientConfig(user.id);
  if (!aiConfig) {
    return NextResponse.json(
      {
        error: 'No AI provider configured',
        hint: 'Add an AI endpoint in AI Studio first',
      },
      { status: 422 },
    );
  }

  const client = new UnifiedAiClient(aiConfig);
  const toneHint = tone ? ` Use a ${tone} tone.` : '';
  const platformHint = platform
    ? ` Optimize it for ${platform} conventions and limits.`
    : '';
  const languageHint = language ? ` Respond in ${language}.` : '';

  try {
    switch (type) {
      case 'ideas': {
        const ideas = await client.generateContentIdeas(
          language ? `${prompt}\n${languageHint.trim()}` : prompt,
          {
            count: count ?? 5,
            ...(platform ? { platform } : {}),
            ...(tone ? { tone } : {}),
          },
        );
        return NextResponse.json({ type, ideas });
      }
      case 'rewrite': {
        if (!platform) {
          return NextResponse.json(
            { error: 'platform is required for type "rewrite"' },
            { status: 400 },
          );
        }
        // Built directly so the language directive lands outside the quoted
        // original text (otherwise identical to rewriteForPlatform).
        const rewritten = await client.generateText(
          buildRewriteUserPrompt(prompt, platform) + languageHint,
          {
            systemPrompt: CONTENT_GENERATION_SYSTEM_PROMPT,
            maxTokens: 600,
            temperature: 0.7,
          },
        );
        return NextResponse.json({ type, text: rewritten.text.trim() });
      }
      case 'hashtags': {
        const result = await client.generateText(
          `Generate 8-12 relevant hashtags for the following social media post topic. ` +
            `Return only the hashtags separated by spaces, no explanations.${platformHint}${toneHint}${languageHint}\n\nTopic: ${prompt}`,
          { maxTokens: 200, temperature: 0.7 },
        );
        return NextResponse.json({ type, text: result.text });
      }
      case 'reply': {
        const result = await client.generateText(
          `Write a short, genuine reply to this social media comment. ` +
            `Keep it under 280 characters, no hashtags.${toneHint}${languageHint}\n\nComment: """${prompt}"""`,
          { maxTokens: 220, temperature: 0.7 },
        );
        return NextResponse.json({ type, text: result.text });
      }
      case 'caption': {
        const result = await client.generateText(
          `Write an engaging social media caption about the following.${platformHint}${toneHint}${languageHint}\n\nTopic: ${prompt}`,
          { maxTokens: 400, temperature: 0.8 },
        );
        return NextResponse.json({ type, text: result.text });
      }
      case 'post':
      default: {
        const result = await client.generateText(
          `Write a complete social media post about the following. ` +
            `Make it engaging with a strong hook and a clear call to action.${platformHint}${toneHint}${languageHint}\n\nTopic: ${prompt}`,
          { maxTokens: 600, temperature: 0.8 },
        );
        return NextResponse.json({ type, text: result.text });
      }
    }
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: `AI provider error: ${err.message}` },
        { status: err.statusCode && err.statusCode < 500 ? 502 : 503 },
      );
    }
    return NextResponse.json(
      { error: `Generation failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
