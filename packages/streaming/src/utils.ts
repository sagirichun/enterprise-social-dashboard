/**
 * Streaming utilities: RTMP validation, ffprobe-based video inspection,
 * bitrate estimation, and ffmpeg binary resolution.
 */

import { existsSync } from 'node:fs';
import ffmpeg from 'fluent-ffmpeg';

export function resolveFfmpegPath(): string {
  const p = process.env.FFMPEG_PATH ?? 'ffmpeg';
  ffmpeg.setFfmpegPath(p);
  return p;
}

export function resolveFfprobePath(): string {
  const p = process.env.FFPROBE_PATH ?? 'ffprobe';
  ffmpeg.setFfprobePath(p);
  return p;
}

/** True when the URL is a usable RTMP(S) ingest endpoint. */
export function validateRtmpUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return /^(rtmps?):\/\/[^/\s]+\/.+/.test(url.trim());
}

/** Join an RTMP base URL and stream key without double slashes. */
export function joinRtmpUrl(base: string, key: string): string {
  const b = base.trim().replace(/\/+$/, '');
  const k = key.trim().replace(/^\/+/, '');
  return `${b}/${k}`;
}

/** Mask the stream key portion of an RTMP URL for safe logging. */
export function maskStreamKey(url: string): string {
  const idx = url.lastIndexOf('/');
  if (idx === -1) return '***';
  return `${url.slice(0, idx + 1)}***`;
}

export interface VideoProbe {
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  videoCodec?: string;
  audioCodec?: string;
  bitrateKbps?: number;
}

function parseFps(value: string | undefined): number {
  if (!value) return 0;
  if (value.includes('/')) {
    const [num, den] = value.split('/').map(Number);
    if (den && Number.isFinite(num / den)) return num / den;
    return 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Inspect a video file with ffprobe. Rejects when the file is missing or unreadable. */
export function probeVideo(path: string): Promise<VideoProbe> {
  return new Promise((resolve, reject) => {
    if (!existsSync(path)) {
      reject(new Error(`Video file not found: ${path}`));
      return;
    }
    resolveFfprobePath();
    ffmpeg.ffprobe(path, (err, data) => {
      if (err) {
        reject(new Error(`ffprobe failed for ${path}: ${err.message}`));
        return;
      }
      const video = (data.streams ?? []).find((s) => s.codec_type === 'video');
      if (!video || !video.width || !video.height) {
        reject(new Error(`No video stream found in ${path}`));
        return;
      }
      const audio = (data.streams ?? []).find((s) => s.codec_type === 'audio');
      const duration = Number(data.format?.duration);
      const bitrate = Number(data.format?.bit_rate);
      resolve({
        width: video.width,
        height: video.height,
        durationSec: Number.isFinite(duration) ? duration : 0,
        fps: parseFps(video.avg_frame_rate ?? video.r_frame_rate),
        videoCodec: video.codec_name,
        audioCodec: audio?.codec_name,
        bitrateKbps: Number.isFinite(bitrate) ? Math.round(bitrate / 1000) : undefined,
      });
    });
  });
}

/**
 * Estimate a sensible target video bitrate for live encoding.
 * Heuristic based on pixel throughput; clamped to 800k..12000k.
 */
export function estimateBitrate(
  width: number,
  height: number,
  fps: number,
  motionFactor = 0.12,
): string {
  if (width <= 0 || height <= 0 || fps <= 0) return '2500k';
  const kbps = Math.round((width * height * fps * motionFactor) / 1000);
  const clamped = Math.min(12000, Math.max(800, kbps));
  return `${clamped}k`;
}

/** Check that ffmpeg and ffprobe binaries are reachable. */
export async function checkBinaries(): Promise<{ ffmpeg: boolean; ffprobe: boolean }> {
  const { execFile } = await import('node:child_process');
  const check = (bin: string): Promise<boolean> =>
    new Promise((resolve) => {
      execFile(bin, ['-version'], (err) => resolve(!err));
    });
  const [ffmpegOk, ffprobeOk] = await Promise.all([
    check(resolveFfmpegPath()),
    check(resolveFfprobePath()),
  ]);
  return { ffmpeg: ffmpegOk, ffprobe: ffprobeOk };
}
