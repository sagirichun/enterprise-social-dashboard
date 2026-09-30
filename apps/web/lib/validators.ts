// Shared Zod schemas for API request validation.

import { z } from 'zod';

export const platformEnum = z.enum([
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'YOUTUBE',
  'X',
  'THREADS',
  'LINKEDIN',
]);

export type PlatformEnum = z.infer<typeof platformEnum>;

export const postStatusEnum = z.enum([
  'DRAFT',
  'QUEUED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
]);

export const sentimentEnum = z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']);

export const aiProviderEnum = z.enum([
  'OPENAI',
  'ANTHROPIC',
  'OLLAMA',
  'LMSTUDIO',
  'CUSTOM',
]);

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

const mediaUrlSchema = z
  .string()
  .refine(
    (v) => v.startsWith('/uploads/') || /^https?:\/\//i.test(v),
    'Media must be an http(s) URL or an uploaded /uploads/ file',
  );

export const createPostSchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000),
  mediaUrls: z.array(mediaUrlSchema).max(10).default([]),
  platforms: z.array(platformEnum).min(1, 'Select at least one platform'),
  // Per-platform category ids, e.g. { YOUTUBE: "shorts" }. Missing entries
  // fall back to each platform's default category at publish time.
  platformCategories: z.record(z.string(), z.string()).default({}),
  thumbnailUrl: mediaUrlSchema.nullable().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

export const schedulePostSchema = z.object({
  postId: z.string().min(1),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const connectAccountSchema = z.object({
  platform: platformEnum,
  providerAccountId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  profileName: z.string().max(200).optional(),
  profileUsername: z.string().max(200).optional(),
  profileImage: z.string().url().optional().or(z.literal('')),
  scopes: z.array(z.string()).default([]),
});

export type ConnectAccountInput = z.infer<typeof connectAccountSchema>;

export const updateAccountSchema = z.object({
  isActive: z.boolean().optional(),
  profileName: z.string().max(200).optional(),
  profileUsername: z.string().max(200).optional(),
  profileImage: z.string().url().optional().or(z.literal('')),
});

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export const createRuleSchema = z.object({
  name: z.string().min(1).max(120).default('Default rule'),
  accountId: z.string().nullable().optional(),
  platform: platformEnum.nullable().optional(),
  isEnabled: z.boolean().default(true),
  promptTemplate: z.string().min(1).max(4000),
  replyDelaySec: z.number().int().min(0).max(86400).default(60),
  sentimentFilter: z.array(sentimentEnum).default([]),
  keywordFilter: z.array(z.string().max(120)).max(50).default([]),
  maxRepliesPerDay: z.number().int().min(1).max(1000).default(50),
});

export type CreateRuleInput = z.infer<typeof createRuleSchema>;

export const updateRuleSchema = createRuleSchema.partial();

export const commentWebhookSchema = z.object({
  platform: platformEnum,
  providerAccountId: z.string().min(1),
  externalId: z.string().min(1),
  parentId: z.string().nullable().optional(),
  authorName: z.string().max(200).nullable().optional(),
  authorAvatar: z.string().url().nullable().optional().or(z.literal('')),
  text: z.string().min(1).max(5000),
});

export type CommentWebhookInput = z.infer<typeof commentWebhookSchema>;

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const aiConfigSchema = z
  .object({
    provider: aiProviderEnum,
    model: z.string().min(1, 'Model is required').max(200),
    baseUrl: z.string().url().nullable().optional().or(z.literal('')),
    apiKey: z.string().nullable().optional(),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().int().min(16).max(32000).default(500),
    systemPrompt: z.string().max(4000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider === 'CUSTOM' && !data.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'baseUrl is required for the CUSTOM provider',
        path: ['baseUrl'],
      });
    }
    if (
      (data.provider === 'OPENAI' || data.provider === 'ANTHROPIC') &&
      !data.apiKey
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `An API key is required for ${data.provider}`,
        path: ['apiKey'],
      });
    }
  });

export type AiConfigInput = z.infer<typeof aiConfigSchema>;

export const generateContentSchema = z.object({
  type: z.enum(['post', 'caption', 'reply', 'hashtags', 'rewrite', 'ideas']),
  prompt: z.string().min(1).max(4000),
  platform: platformEnum.optional(),
  tone: z.string().max(60).optional(),
  count: z.number().int().min(1).max(10).default(1).optional(),
});

export type GenerateContentInput = z.infer<typeof generateContentSchema>;

// ---------------------------------------------------------------------------
// Live streams
// ---------------------------------------------------------------------------

export const createLiveStreamSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  videoUrl: z.string().min(1, 'A source video is required').max(2000),
  rtmpUrl: z.string().min(1, 'RTMP URL is required').max(500),
  rtmpKey: z.string().min(1, 'Stream key is required').max(500),
  platform: platformEnum,
  loop: z.boolean().default(true),
  thumbnailUrl: z.string().max(2000).nullable().optional(),
});

export type CreateLiveStreamInput = z.infer<typeof createLiveStreamSchema>;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
