# Enterprise Social Media Management Dashboard

An all-in-one, production-ready platform for managing social media at enterprise
scale: connect accounts across Facebook, Instagram, TikTok, YouTube, X (Twitter)
and Threads, schedule and auto-publish content, auto-reply to comments with AI,
run 24/7 looped live streams to RTMP endpoints, and analyze performance from a
single premium dashboard.

AI features are provider-agnostic: point the platform at OpenAI or Anthropic in
the cloud, or at a local Ollama / LM Studio server, per workspace.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Tech Stack](#tech-stack)
3. [Prerequisites](#prerequisites)
4. [Quick Start](#quick-start)
5. [Environment Variables](#environment-variables)
6. [Database](#database)
7. [Background Workers & Queues](#background-workers--queues)
8. [API Overview](#api-overview)
9. [AI Provider Configuration](#ai-provider-configuration)
10. [Live Streaming Guide (FFmpeg to RTMP)](#live-streaming-guide-ffmpeg-to-rtmp)
11. [OAuth App Setup per Platform](#oauth-app-setup-per-platform)
12. [Project Structure](#project-structure)
13. [Scripts Reference](#scripts-reference)
14. [Production Deployment Notes](#production-deployment-notes)

---

## Architecture

```
                         +-------------------+
                         |   Social Platforms |
                         | FB IG TikTok YT X  |
                         | Threads            |
                         +---------+---------+
                                   | OAuth 2.0 / Graph APIs / Webhooks
                                   v
+----------+    +------------------------------------------+    +-----------+
|  Browser |<-->|  apps/web (Next.js 14 App Router)         |<-->| Postgres  |
|  (React  |    |  - Server Components + Route Handlers    |    | 16 (Prisma|
|   18 UI) |    |  - NextAuth.js (workspace sessions)      |    |  ORM)     |
+----------+    |  - REST API: /api/*                      |    +-----------+
                |  - Webhook ingress: /api/webhooks/*      |
                +------+----------------------------+------+
                       | BullMQ jobs over Redis     | Prisma queries
                       v                            |
                +-----------------------------------+------+
                |  Background workers (tsx)               |
                |  - scheduler.worker   (delayed posts)   |
                |  - publisher.worker   (platform APIs)   |
                |  - autoreply.worker   (AI comment reply)|
                |  - media.worker       (transcode/crop)  |
                |  - stream.supervisor  (FFmpeg RTMP)     |
                +------------------+----------------------+
                                   |
                +------------------+----------------------+
                |  packages/* (shared libraries)          |
                |  - @dashboard/db        Prisma client   |
                |  - @dashboard/queue     BullMQ queues   |
                |  - @dashboard/ai        provider router |
                |  - @dashboard/streaming  FFmpeg manager |
                +----------------------------------------+
                                   |
                         +---------+---------+
                         |  Redis 7 (queues, |
                         |  rate limits,     |
                         |  session cache)   |
                         +-------------------+
```

**Request flow for a scheduled post**

1. User creates a post in the dashboard (draft with text, media, target
   accounts, scheduled time).
2. The API validates with Zod, persists the `Post` row (Prisma), and enqueues
   a delayed job on the `publish` BullMQ queue.
3. At fire time, `publisher.worker` picks up the job, refreshes OAuth tokens
   if needed, uploads media to each platform, publishes, and writes back
   platform post IDs, status, and errors.
4. Failures are retried with exponential backoff; dead-lettered jobs surface
   in the dashboard's queue inspector.

**Request flow for AI auto-reply**

1. Platform webhook (`/api/webhooks/:platform`) receives a comment event,
   verifies the signature with `WEBHOOK_SECRET`, and enqueues a job on the
   `autoreply` queue.
2. `autoreply.worker` loads the workspace's AI settings and reply policy
   (tone, guardrails, human-escalation rules), calls `@dashboard/ai`, and
   posts the reply through the platform API.
3. Sentiment is scored and stored alongside the comment for the analytics
   views.

---

## Tech Stack

| Layer      | Choice                                              |
| ---------- | --------------------------------------------------- |
| Monorepo   | npm workspaces + Turborepo                          |
| Web app    | Next.js 14 (App Router), React 18, TypeScript (strict) |
| Styling    | Tailwind CSS, custom enterprise design tokens       |
| Icons      | lucide-react                                        |
| Charts     | recharts                                            |
| Database   | PostgreSQL 16 via Prisma ORM                        |
| Queue      | Redis 7 + BullMQ 5                                  |
| Auth       | NextAuth.js (Auth.js v4)                            |
| AI         | Abstraction over OpenAI, Anthropic, Ollama, LM Studio |
| Streaming  | FFmpeg (libx264 + AAC) to RTMP                      |
| Validation | Zod                                                 |
| State      | Zustand (client), TanStack Query (server state)     |

---

## Prerequisites

- Node.js >= 20 and npm >= 10
- Docker and Docker Compose (for PostgreSQL + Redis)
- FFmpeg with libx264 and AAC support (for live streaming)
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
- At least one AI provider: an OpenAI/Anthropic API key, or a local
  Ollama (`ollama serve`) / LM Studio server.

---

## Quick Start

```bash
# 1. Clone and enter the repository
git clone <repository-url>
cd enterprise-social-dashboard

# 2. Install all workspace dependencies
npm install

# 3. Start infrastructure (PostgreSQL 16 + Redis 7)
docker compose up -d

# 4. Configure environment
cp .env.example .env
# Edit .env - at minimum set DATABASE_URL, NEXTAUTH_SECRET and one AI provider.

# 5. Generate Prisma client and run migrations
npm run db:generate
npm run db:migrate

# 6. (Optional) Seed a demo workspace
npm run db:seed

# 7. Start the web app
npm run dev
# App is live at http://localhost:3000

# 8. In a second terminal, start the background workers
npm run worker:dev
```

Verify the setup:

```bash
docker compose ps                 # postgres + redis healthy
curl http://localhost:3000/healthz  # -> { "status": "ok", ... }
```

---

## Environment Variables

All variables are documented in `.env.example`. The critical groups:

| Variable | Purpose | Required |
| -------- | ------- | -------- |
| `DATABASE_URL` | Prisma connection string for PostgreSQL | Yes |
| `REDIS_URL` | BullMQ connection string for Redis | Yes |
| `NEXTAUTH_SECRET` | Session encryption (`openssl rand -base64 32`) | Yes |
| `AI_DEFAULT_PROVIDER` | `openai` / `anthropic` / `ollama` / `lmstudio` | Yes |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Cloud AI providers | One AI provider |
| `OLLAMA_BASE_URL` / `LMSTUDIO_BASE_URL` | Local AI servers | Alternative |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Meta OAuth (Facebook + Instagram) | For FB/IG |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok OAuth | For TikTok |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | Google OAuth (YouTube) | For YouTube |
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` | X OAuth 2.0 | For X |
| `THREADS_APP_ID` / `THREADS_APP_SECRET` | Threads OAuth (Meta) | For Threads |
| `WEBHOOK_SECRET` | Verifies inbound platform webhooks | Yes |
| `FFMPEG_PATH` | Path to the ffmpeg binary | For live streaming |

Per-workspace AI overrides (provider, model, API key) can additionally be
configured from **Settings > AI Providers** in the dashboard UI and are stored
encrypted in the database.

---

## Database

The schema lives in `packages/db/prisma/schema.prisma` (Prisma). Core models:

- `Workspace`, `WorkspaceMember`, `User` - multi-tenant accounts and roles
- `SocialAccount` - connected platform accounts with encrypted OAuth tokens
- `Post`, `PostTarget`, `MediaAsset` - scheduled/published content
- `Comment`, `AutoReplyLog` - inbound engagement and AI replies
- `LiveStream`, `StreamDestination` - 24/7 looped streams and RTMP targets
- `AiProviderConfig` - per-workspace AI settings (encrypted secrets)
- `AnalyticsSnapshot` - cached platform metrics for dashboards

Common commands (run from the repo root):

```bash
npm run db:generate         # regenerate Prisma client
npm run db:migrate          # create + apply a migration (dev)
npm run db:migrate:deploy   # apply pending migrations (CI / production)
npm run db:seed             # seed demo workspace
npm run db:studio           # open Prisma Studio
```

---

## Background Workers & Queues

Queues are defined in `packages/queue`; worker processes live in
`apps/web/src/workers/` and run via `tsx` (no separate build step).

| Queue | Worker file | Purpose |
| ----- | ----------- | ------- |
| `publish` | `publisher.worker.ts` | Executes scheduled posts against platform APIs |
| `autoreply` | `autoreply.worker.ts` | Generates and posts AI replies to comments |
| `media` | `media.worker.ts` | Transcodes uploads, generates thumbnails, smart-crops video |
| `streams` | `stream.supervisor.ts` | Manages FFmpeg RTMP processes, restarts on failure |
| `analytics` | `analytics.worker.ts` | Periodic metrics sync from platform APIs |

```bash
npm run worker        # production worker entrypoint (apps/web)
npm run worker:dev    # watch mode for development

# Inspect queues during development (Bull Board is mounted in dev only)
open http://localhost:3000/admin/queues
```

Concurrency, rate limits and retry policies are configured per queue in
`packages/queue/src/queues.ts`. Failed jobs use exponential backoff
(3 attempts default) and land in the dead-letter view of the dashboard.

---

## API Overview

All routes are Next.js Route Handlers under `apps/web/src/app/api`.
Authentication is enforced via NextAuth session + workspace membership.

**Accounts**
- `GET /api/accounts` - list connected social accounts for the workspace
- `POST /api/oauth/:platform/authorize` - start OAuth flow
- `GET /api/oauth/:platform/callback` - OAuth callback, token exchange
- `DELETE /api/accounts/:id` - disconnect an account

**Posts & scheduling**
- `GET/POST /api/posts` - list / create posts (Zod-validated)
- `GET/PATCH/DELETE /api/posts/:id` - read / update / delete
- `POST /api/posts/:id/schedule` - enqueue for a future time
- `POST /api/posts/:id/publish-now` - publish immediately
- `POST /api/media/upload` - multipart upload, returns `MediaAsset`

**Engagement & AI**
- `GET /api/comments` - inbound comments with sentiment scores
- `POST /api/comments/:id/reply` - manual reply
- `GET/PATCH /api/settings/auto-reply` - AI reply policy configuration
- `POST /api/ai/generate` - content studio: captions, hashtags, rewrites
- `POST /api/ai/sentiment` - score arbitrary text

**Live streams**
- `GET/POST /api/streams` - list / create looped live streams
- `POST /api/streams/:id/start` - launch FFmpeg -> RTMP
- `POST /api/streams/:id/stop` - terminate the stream
- `GET /api/streams/:id/status` - process health, bitrate, uptime

**Webhooks (signature-verified, no session required)**
- `GET/POST /api/webhooks/facebook` - Meta verification + comment events
- `POST /api/webhooks/tiktok` - TikTok events
- `POST /api/webhooks/youtube` - YouTube PubSubHubbub notifications

**System**
- `GET /api/health` - liveness (also served at `/healthz`)
- `GET /api/queue/stats` - BullMQ queue depths and worker counts

---

## AI Provider Configuration

`packages/ai` exposes a single interface; every feature (auto-reply, content
generation, sentiment analysis) goes through it:

```ts
import { createAiClient } from "@dashboard/ai";

const ai = createAiClient({
  provider: "ollama", // or "openai" | "anthropic" | "lmstudio"
  model: "llama3.1",
  baseUrl: "http://localhost:11434",
});

const reply = await ai.chat({
  system: "You are a friendly social media manager...",
  messages: [{ role: "user", content: comment.text }],
  temperature: 0.7,
  maxTokens: 280,
});
```

- **OpenAI / Anthropic**: set the API key and model in `.env`.
- **Ollama**: run `ollama serve`, pull a model (`ollama pull llama3.1`), and
  set `AI_DEFAULT_PROVIDER=ollama`.
- **LM Studio**: start the local server (default `http://localhost:1234/v1`)
  and set `AI_DEFAULT_PROVIDER=lmstudio`.

Per-workspace overrides in **Settings > AI Providers** take precedence over
`.env` and are encrypted at rest with `NEXTAUTH_SECRET`-derived keys.

---

## Live Streaming Guide (FFmpeg to RTMP)

The auto live-stream feature loops one or more pre-recorded videos and pushes
a continuous RTMP feed - useful for 24/7 channels, premieres, and scheduled
rebroadcasts.

**How it works**

1. Upload source videos via **Streams > Library** (stored under
   `STREAM_RECORDINGS_DIR`, transcoded to a stream-safe profile by the media
   worker: H.264, AAC, 30fps).
2. Create a stream, attach one or more videos (they play in loop order) and
   add destinations: each destination is an RTMP URL + stream key pair taken
   from the target platform (YouTube Live, Facebook Live, TikTok Live Studio,
   or any custom RTMP ingest).
3. Press **Start**. `stream.supervisor` spawns a supervised FFmpeg process:

```bash
ffmpeg -re -stream_loop -1 -i input.mp4 \
  -c:v libx264 -preset veryfast -b:v 4500k -maxrate 4500k -bufsize 9000k \
  -pix_fmt yuv420p -g 60 -c:a aac -b:a 128k -ar 44100 \
  -f flv rtmp://ingest.example.com/live/STREAM_KEY
```

4. The supervisor heartbeats to Redis; if FFmpeg exits unexpectedly it is
   restarted with backoff. **Stop** from the dashboard terminates the process
   cleanly.

**Notes**

- One FFmpeg process per active stream; size the host accordingly
  (roughly 1 vCPU per 1080p30 software-encoded stream).
- Stream keys are encrypted in the database and never exposed to the client.
- For production, run workers on a dedicated host with FFmpeg installed and
  set `FFMPEG_PATH` accordingly.

---

## OAuth App Setup per Platform

Create one developer app per platform, then copy the client ID/secret into
`.env`. Redirect URIs follow the pattern
`{APP_URL}/api/oauth/{platform}/callback`.

| Platform | Developer console | Notes |
| -------- | ----------------- | ----- |
| Facebook / Instagram | developers.facebook.com | Request `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish` |
| TikTok | developers.tiktok.com | Apply for production scopes: `video.upload`, `video.publish` |
| YouTube | console.cloud.google.com | Enable YouTube Data API v3; OAuth scopes `youtube.upload`, `youtube.force-ssl` |
| X (Twitter) | developer.x.com | OAuth 2.0 PKCE app with Read + Write permissions |
| Threads | developers.facebook.com | Threads use case; `threads_basic`, `threads_content_publish` |

For local development, most platforms accept `http://localhost:3000` redirect
URIs; TikTok and X may require HTTPS - use a tunnel (e.g. ngrok) and set
`APP_URL` / `NEXTAUTH_URL` to the tunnel URL.

---

## Project Structure

```
enterprise-social-dashboard/
  apps/
    web/                        Next.js 14 application
      src/
        app/                    App Router pages + API route handlers
          (dashboard)/          Authenticated dashboard routes
          api/                  REST API + webhooks + OAuth callbacks
        components/             UI components (lucide-react icons)
        lib/                    OAuth clients, platform API wrappers
        workers/                BullMQ worker entrypoints (tsx)
      prisma/                   (re-exported) see packages/db
  packages/
    db/                         Prisma schema, client, seeds, migrations
      prisma/
        schema.prisma
        migrations/
        seed.ts
      src/                      Typed client singleton + repositories
    queue/                      BullMQ queue definitions, job types, Redis client
      src/
        connection.ts
        queues.ts
        jobs.ts
    ai/                         Provider-agnostic AI abstraction
      src/
        client.ts               createAiClient factory
        providers/
          openai.ts
          anthropic.ts
          ollama.ts
          lmstudio.ts
        prompts/                System prompts for reply/generate/sentiment
    streaming/                  FFmpeg process manager for RTMP streams
      src/
        ffmpeg.ts
        supervisor.ts
        profiles.ts
  docker-compose.yml            PostgreSQL 16 + Redis 7
  turbo.json                    Turborepo pipeline
  package.json                  npm workspaces root
  .env.example                  Full environment template
```

---

## Scripts Reference

Run from the repository root (Turborepo orchestrates the workspaces):

| Command | Description |
| ------- | ----------- |
| `npm run dev` | Start all apps in development mode |
| `npm run build` | Build all apps and packages |
| `npm run typecheck` | Strict `tsc --noEmit` across the repo |
| `npm run lint` | ESLint across the repo |
| `npm run test` | Run test suites |
| `npm run format` | Prettier write |
| `npm run worker` | Start background workers (production) |
| `npm run worker:dev` | Start background workers (watch mode) |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Dev migration |
| `npm run db:migrate:deploy` | Apply migrations (CI/prod) |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Prisma Studio |
| `docker compose up -d` | Start PostgreSQL + Redis |
| `docker compose down` | Stop infrastructure |
| `docker compose logs -f` | Tail infrastructure logs |

---

## Production Deployment Notes

1. **Infrastructure**: run PostgreSQL 16 and Redis 7 as managed services
   (or the provided compose file on a dedicated host). Enable Redis AOF
   persistence - it is already configured in `docker-compose.yml`.
2. **Secrets**: never commit `.env`. Provide secrets via your platform's
   secret manager. Rotate `NEXTAUTH_SECRET` and `WEBHOOK_SECRET` per
   environment.
3. **Migrations**: run `npm run db:migrate:deploy` before starting the app.
4. **Processes**: deploy three process types - `web` (`npm start`),
   `worker` (`npm run worker`), and optionally a dedicated `stream` worker
   host with FFmpeg for live streaming.
5. **Scaling**: BullMQ workers scale horizontally; add worker replicas and
   raise per-queue concurrency in `packages/queue/src/queues.ts`. Sticky
   stream supervision: run exactly one `stream.supervisor` replica.
6. **Security**: terminate TLS at the edge, keep `/api/webhooks/*` public
   but signature-verified, and restrict `/admin/queues` to operators.
7. **Observability**: workers log structured JSON; aggregate via your log
   pipeline. Key metrics to alert on: queue depth, dead-letter count,
   FFmpeg restart rate, OAuth token refresh failures.

---

## License

Proprietary - all rights reserved. Contact the repository owner for licensing
terms.
