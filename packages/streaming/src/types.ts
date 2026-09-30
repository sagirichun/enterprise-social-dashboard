/**
 * Core types for the 24/7 auto-live streaming service.
 */

import type { ChildProcess } from 'node:child_process';

export interface StreamConfig {
  /** Unique stream id, e.g. "tiktok-main". */
  id: string;
  name?: string;
  /** Absolute path to the source video file that will be looped. */
  videoPath: string;
  /** RTMP ingest base URL, e.g. "rtmp://live.twitch.tv/app". No trailing key. */
  rtmpUrl: string;
  /** Stream key appended to rtmpUrl. */
  streamKey: string;
  /** Loop the source video forever. Defaults to true. */
  loop?: boolean;
  /** Set to false to skip auto-start when the service boots. Defaults to true. */
  enabled?: boolean;
  width?: number;
  height?: number;
  framerate?: number;
  /** e.g. "2500k". Defaults to "2500k". */
  videoBitrate?: string;
  /** e.g. "128k". Defaults to "128k". */
  audioBitrate?: string;
  /** x264 preset. Defaults to "veryfast". */
  preset?: string;
}

export type StreamState =
  | 'idle'
  | 'starting'
  | 'live'
  | 'reconnecting'
  | 'stopped'
  | 'error';

export interface StreamStatus {
  id: string;
  name?: string;
  state: StreamState;
  pid?: number;
  startedAt?: string;
  uptimeSec: number;
  restarts: number;
  lastError?: string;
  destination: string;
}

/** Result of spawning the ffmpeg loop process. */
export interface SpawnedStream {
  process: ChildProcess;
  /** Full argv passed to ffmpeg (for logging / debugging). */
  args: string[];
  /** Redacted destination (stream key masked). */
  destination: string;
  /** Full destination URL including the stream key. */
  destinationFull: string;
}
