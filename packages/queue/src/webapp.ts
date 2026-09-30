/**
 * Bridge to shared backend modules that live in the web app.
 *
 * The platform adapters and the token encryption helpers are owned by
 * apps/web/lib (per the monorepo layout), but the background workers run
 * from @dashboard/queue and need them too. This single bridge module keeps
 * the cross-package relative import in one place; long term these should
 * move into a dedicated @dashboard/platforms package.
 */

export { encrypt, decrypt } from '../../../apps/web/lib/encryption';
export { getPlatformAdapter } from '../../../apps/web/lib/platforms/index';
export type {
  PlatformAdapter,
  PublishPostInput,
  PublishPostResult,
  ReplyToCommentInput,
  AnalyticsInput,
  AnalyticsResult,
} from '../../../apps/web/lib/platforms/types';
export { PlatformApiError } from '../../../apps/web/lib/platforms/types';
