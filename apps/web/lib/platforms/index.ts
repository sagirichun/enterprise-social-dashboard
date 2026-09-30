// Platform adapter registry.
// Workers and services resolve adapters through getPlatformAdapter() so the
// rest of the codebase never branches on platform names.

import { facebookAdapter } from './facebook';
import { instagramAdapter } from './instagram';
import { tiktokAdapter } from './tiktok';
import { youtubeAdapter } from './youtube';
import { xAdapter } from './x';
import { threadsAdapter } from './threads';
import type { PlatformAdapter, PlatformName } from './types';

const registry: Record<string, PlatformAdapter> = {
  FACEBOOK: facebookAdapter,
  INSTAGRAM: instagramAdapter,
  TIKTOK: tiktokAdapter,
  YOUTUBE: youtubeAdapter,
  X: xAdapter,
  THREADS: threadsAdapter,
};

export function getPlatformAdapter(platform: string): PlatformAdapter {
  const key = platform.toUpperCase();
  const adapter = registry[key];
  if (!adapter) {
    throw new Error(
      `No publishing adapter registered for platform "${platform}". ` +
        `Supported: ${Object.keys(registry).join(', ')}`,
    );
  }
  return adapter;
}

export function supportedPlatforms(): PlatformName[] {
  return Object.keys(registry) as PlatformName[];
}

export type { PlatformAdapter, PlatformName };
