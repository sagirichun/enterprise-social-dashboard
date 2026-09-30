/**
 * FFmpeg command builder and process spawner for 24/7 RTMP loop streaming.
 *
 * The loop itself is spawned directly via child_process for maximum control
 * over the long-lived process lifecycle; fluent-ffmpeg is used elsewhere in
 * this package for probing (utils.ts) and transcoding (addons/crop.ts).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { SpawnedStream, StreamConfig } from './types';
import { joinRtmpUrl, maskStreamKey, resolveFfmpegPath, validateRtmpUrl } from './utils';

export const FFMPEG_DEFAULTS = {
  videoBitrate: '2500k',
  audioBitrate: '128k',
  width: 1280,
  height: 720,
  framerate: 30,
  preset: 'veryfast',
} as const;

export function validateStreamConfig(config: StreamConfig): void {
  if (!config || typeof config !== 'object') throw new Error('StreamConfig is required');
  if (!config.id) throw new Error('StreamConfig.id is required');
  if (!config.videoPath) throw new Error(`Stream "${config.id}": videoPath is required`);
  if (!existsSync(config.videoPath)) {
    throw new Error(`Stream "${config.id}": video file not found: ${config.videoPath}`);
  }
  if (!config.rtmpUrl || !validateRtmpUrl(config.rtmpUrl)) {
    throw new Error(`Stream "${config.id}": rtmpUrl must start with rtmp:// or rtmps://`);
  }
  if (!config.streamKey) throw new Error(`Stream "${config.id}": streamKey is required`);
}

/** Double a "2500k"/"2.5M" style bitrate for the encoder buffer size. */
function doubleBitrate(bitrate: string): string {
  const match = bitrate.trim().match(/^([\d.]+)\s*([kKmM])?$/);
  if (!match) return bitrate;
  const value = parseFloat(match[1]) * 2;
  const unit = (match[2] ?? 'k').toLowerCase();
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`;
}

/**
 * Build the ffmpeg argv for a 24/7 looped RTMP stream.
 * Pure function: safe to unit test, no side effects.
 */
export function buildFfmpegArgs(config: StreamConfig): string[] {
  const width = config.width ?? FFMPEG_DEFAULTS.width;
  const height = config.height ?? FFMPEG_DEFAULTS.height;
  const framerate = config.framerate ?? FFMPEG_DEFAULTS.framerate;
  const videoBitrate = config.videoBitrate ?? FFMPEG_DEFAULTS.videoBitrate;
  const audioBitrate = config.audioBitrate ?? FFMPEG_DEFAULTS.audioBitrate;
  const preset = config.preset ?? FFMPEG_DEFAULTS.preset;
  const destination = joinRtmpUrl(config.rtmpUrl, config.streamKey);
  const loop = config.loop !== false;

  const args: string[] = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-stats',
  ];
  if (loop) args.push('-stream_loop', '-1');
  args.push(
    '-re',
    '-i', config.videoPath,
    // Video: H.264, widely accepted by RTMP ingest servers.
    '-c:v', 'libx264',
    '-preset', preset,
    '-b:v', videoBitrate,
    '-maxrate', videoBitrate,
    '-bufsize', doubleBitrate(videoBitrate),
    '-pix_fmt', 'yuv420p',
    '-g', String(framerate * 2),
    '-r', String(framerate),
    '-vf', `scale=${width}:${height}`,
    // Audio: AAC, required by most RTMP servers.
    '-c:a', 'aac',
    '-b:a', audioBitrate,
    '-ar', '44100',
    '-ac', '2',
    // Output.
    '-f', 'flv',
    destination,
  );
  return args;
}

/**
 * Validate the config and spawn the ffmpeg loop process.
 * Returns the child process plus the argv used (for logs / debugging).
 */
export function buildLoopCommand(config: StreamConfig): SpawnedStream {
  validateStreamConfig(config);
  const args = buildFfmpegArgs(config);
  const destinationFull = joinRtmpUrl(config.rtmpUrl, config.streamKey);
  const child = spawn(resolveFfmpegPath(), args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return {
    process: child,
    args,
    destination: maskStreamKey(destinationFull),
    destinationFull,
  };
}
