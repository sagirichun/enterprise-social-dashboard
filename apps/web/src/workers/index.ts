/**
 * Background worker entrypoint for the web app.
 *
 * Run with:  npm run worker --workspace=@dashboard/web
 * (tsx apps/web/src/workers/index.ts)
 *
 * Starts the post-publisher, auto-replier, media-processor and scheduler
 * workers from @dashboard/queue. Run this as a separate long-lived process
 * next to `next start`.
 */

import { startWorkers } from '@dashboard/queue';

/* Wrapped in main() instead of top-level await: tsx treats this file as CJS
   (apps/web has no "type": "module"), and CJS does not allow top-level await. */
async function main(): Promise<void> {
  await startWorkers();
}

main().catch((err: unknown) => {
  console.error('[worker] failed to start:', err);
  process.exit(1);
});
