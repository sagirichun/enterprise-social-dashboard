/**
 * Shared platform metadata: URL slug <-> Prisma Platform enum <-> display label.
 * Used by dashboard pages and the OAuth connect flow UI.
 */

export const PLATFORM_META = {
  facebook: { label: 'Facebook', blurb: 'Facebook Pages you manage' },
  instagram: { label: 'Instagram', blurb: 'Business or creator accounts linked to your Pages' },
  tiktok: { label: 'TikTok', blurb: 'Accounts with posting API access' },
  youtube: { label: 'YouTube', blurb: 'YouTube channels you own' },
  x: { label: 'X', blurb: 'X (Twitter) accounts' },
  threads: { label: 'Threads', blurb: 'Threads profiles' },
} as const;

export type PlatformSlug = keyof typeof PLATFORM_META;

export const PLATFORM_SLUGS = Object.keys(PLATFORM_META) as PlatformSlug[];

/**
 * Post categories each platform supports in the composer.
 * `id` is stored in Post.platformCategories (e.g. { YOUTUBE: "shorts" }).
 * `needsVideo` / `needsImage` hint what media the category requires.
 */
export interface PostCategory {
  id: string;
  label: string;
  blurb: string;
  needsVideo?: boolean;
  needsImage?: boolean;
}

export const PLATFORM_CATEGORIES: Record<PlatformSlug, PostCategory[]> = {
  facebook: [
    { id: 'post', label: 'Post', blurb: 'Text, photo or video on your Page' },
    { id: 'reel', label: 'Reel', blurb: 'Short vertical video', needsVideo: true },
  ],
  instagram: [
    { id: 'post', label: 'Post', blurb: 'Photo or video in the feed', needsImage: true },
    { id: 'reel', label: 'Reel', blurb: 'Short vertical video', needsVideo: true },
    { id: 'story', label: 'Story', blurb: 'Photo or short video, 24 hours' },
  ],
  tiktok: [
    { id: 'video', label: 'Video', blurb: 'Standard TikTok video', needsVideo: true },
    { id: 'carousel', label: 'Photo carousel', blurb: 'Swipeable photos with music', needsImage: true },
  ],
  youtube: [
    { id: 'video', label: 'Video', blurb: 'Standard YouTube video', needsVideo: true },
    { id: 'shorts', label: 'Shorts', blurb: 'Vertical video up to 3 minutes', needsVideo: true },
  ],
  x: [
    { id: 'post', label: 'Post', blurb: 'Text with optional photo or video' },
  ],
  threads: [
    { id: 'post', label: 'Post', blurb: 'Text with optional photo or video' },
  ],
};

/** Default category id for a platform (first in its list). */
export function defaultCategoryFor(slug: PlatformSlug): string {
  return PLATFORM_CATEGORIES[slug][0]?.id ?? 'post';
}

/** Find a category definition by platform slug + id. */
export function categoryFor(slug: PlatformSlug, id: string): PostCategory | null {
  return PLATFORM_CATEGORIES[slug].find((c) => c.id === id) ?? null;
}

/** Prisma Platform enum value -> URL slug (e.g. "FACEBOOK" -> "facebook"). */
export function slugFromEnum(value: string): PlatformSlug | null {
  const slug = value.toLowerCase();
  return (PLATFORM_SLUGS as string[]).includes(slug) ? (slug as PlatformSlug) : null;
}

/** URL slug -> Prisma Platform enum value (e.g. "facebook" -> "FACEBOOK"). */
export function enumFromSlug(slug: PlatformSlug): string {
  return slug.toUpperCase();
}

/** Human label for a Prisma Platform enum value. */
export function labelFromEnum(value: string): string {
  const slug = slugFromEnum(value);
  return slug ? PLATFORM_META[slug].label : value;
}
