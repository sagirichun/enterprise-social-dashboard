-- Additive, idempotent migration: media library + per-platform post
-- categories + thumbnails + multi AI endpoints.
-- Safe to run on an existing database: only ADDs columns/tables, never
-- drops, renames or deletes anything. IF NOT EXISTS guards make it
-- re-runnable.

-- Post: per-platform category map + optional thumbnail URL.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "platformCategories" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT;

-- LiveStream: optional thumbnail URL.
ALTER TABLE "LiveStream" ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT;

-- MediaAsset: file-manager rows for uploads on server disk.
CREATE TABLE IF NOT EXISTS "MediaAsset" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "url" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MediaAsset_userId_createdAt_idx" ON "MediaAsset"("userId", "createdAt");

-- AiEndpoint: multiple named AI endpoints per user (9Router, Ollama, OpenAI...).
CREATE TABLE IF NOT EXISTS "AiEndpoint" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Default',
  "provider" "AiProvider" NOT NULL DEFAULT 'OPENAI',
  "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  "baseUrl" TEXT,
  "apiKeyEncrypted" TEXT,
  "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  "maxTokens" INTEGER NOT NULL DEFAULT 500,
  "systemPrompt" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "lastCheckAt" TIMESTAMP(3),
  "lastCheckOk" BOOLEAN,
  "lastCheckError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiEndpoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiEndpoint_userId_idx" ON "AiEndpoint"("userId");

-- Foreign keys (only added when missing).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MediaAsset_userId_fkey'
  ) THEN
    ALTER TABLE "MediaAsset"
      ADD CONSTRAINT "MediaAsset_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiEndpoint_userId_fkey'
  ) THEN
    ALTER TABLE "AiEndpoint"
      ADD CONSTRAINT "AiEndpoint_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
