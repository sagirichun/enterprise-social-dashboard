// Server-side media storage for the file manager / media library.
// Files live under <app>/public/uploads (served statically at /uploads/*)
// and are tracked in the MediaAsset table. The platform adapters can read
// them straight from disk via resolveLocalPath().

import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";

export const UPLOADS_URL_PREFIX = "/uploads/";

export function uploadsDir(): string {
  const env = process.env.MEDIA_UPLOADS_DIR?.trim();
  if (env) return path.resolve(env);
  // `next start` is usually launched from the repo root via
  // `npm start --workspace=@dashboard/web`, so process.cwd() is NOT apps/web.
  // Resolve the statically-served public/uploads dir either way.
  if (existsSync(path.join(process.cwd(), "apps", "web", "package.json"))) {
    return path.join(process.cwd(), "apps", "web", "public", "uploads");
  }
  return path.join(process.cwd(), "public", "uploads");
}

export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
};

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

function safeFileName(originalName: string, mime: string): string {
  const ext = extForMime(mime);
  const base = (originalName.split(".")[0] ?? "file")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "file";
  return `${crypto.randomBytes(6).toString("hex")}_${base}.${ext}`;
}

export interface StoredFile {
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
}

/** Persist raw bytes as an upload. Returns the public URL. */
export async function storeBuffer(
  data: Buffer,
  originalName: string,
  mimeType: string,
): Promise<StoredFile> {
  if (!isAllowedMime(mimeType)) {
    throw new Error(`Unsupported media type: ${mimeType}`);
  }
  if (data.length === 0) {
    throw new Error("Empty file");
  }
  if (data.length > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File too large (${Math.round(data.length / 1024 / 1024)} MB > 512 MB)`,
    );
  }
  const dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });
  const fileName = safeFileName(originalName, mimeType);
  await fs.writeFile(path.join(dir, fileName), data);
  return {
    fileName,
    url: `${UPLOADS_URL_PREFIX}${fileName}`,
    size: data.length,
    mimeType,
  };
}

/** Persist a web File (from formData) as an upload. */
export async function storeWebFile(file: File): Promise<StoredFile> {
  const mimeType = file.type || "application/octet-stream";
  const buffer = Buffer.from(await file.arrayBuffer());
  return storeBuffer(buffer, file.name || "upload", mimeType);
}

/**
 * Map a public /uploads/* URL back to its absolute disk path.
 * Returns null for non-local URLs or path-traversal attempts.
 */
export function resolveLocalPath(url: string): string | null {
  if (!url.startsWith(UPLOADS_URL_PREFIX)) return null;
  const rel = url.slice(UPLOADS_URL_PREFIX.length);
  if (!rel || rel.includes("..") || rel.includes("/") || rel.includes("\\")) {
    return null;
  }
  return path.join(uploadsDir(), rel);
}

/**
 * Convert a local /uploads/* URL into an absolute public URL that platform
 * APIs (Meta, TikTok, X...) can fetch. Platforms download media from THEIR
 * servers, so the file must be reachable over the public internet — set
 * APP_URL (or NEXTAUTH_URL) to your public address (e.g. a tunnel URL).
 * Absolute http(s) URLs pass through unchanged.
 */
export function toPublicMediaUrl(url: string): string {
  if (!url.startsWith(UPLOADS_URL_PREFIX)) return url;
  const base = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "").trim();
  if (!/^https?:\/\//i.test(base) || /localhost|127\.0\.0\.1/i.test(base)) {
    throw new Error(
      "Local upload cannot be published: set APP_URL in apps/web/.env to the " +
        "dashboard's public URL (e.g. https://example.com) so platforms can " +
        "download the file. Remote http(s) media URLs are unaffected."
    );
  }
  return `${base.replace(/\/+$/, "")}${url}`;
}

/** True when the URL points at a locally stored upload. */
export function isLocalUploadUrl(url: string): boolean {
  return url.startsWith(UPLOADS_URL_PREFIX);
}

/** Delete an uploaded file from disk. Never throws for missing files. */
export async function deleteStoredFile(fileName: string): Promise<void> {
  const safe = path.basename(fileName);
  try {
    await fs.unlink(path.join(uploadsDir(), safe));
  } catch {
    /* already gone */
  }
}
