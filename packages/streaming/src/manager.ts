/**
 * StreamManager: supervises 24/7 ffmpeg RTMP loop processes.
 *
 * - start / stop / restart individual streams
 * - automatic restart on crash with exponential backoff
 * - backoff reset after a sustained stable window
 * - ring-buffer logs per stream (last N stderr lines)
 * - health checks and status listing
 * - emits lifecycle events: start, live, reconnecting, stop, error, failed
 */

import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { StreamConfig, StreamState, StreamStatus } from './types';
import { buildLoopCommand } from './ffmpeg';
import { joinRtmpUrl } from './utils';

export interface StreamManagerOptions {
  /** Max automatic restarts before giving up. Defaults to 20. */
  maxRestarts?: number;
  /** Initial reconnect delay. Defaults to 2000 ms. */
  baseBackoffMs?: number;
  /** Max reconnect delay. Defaults to 60000 ms. */
  maxBackoffMs?: number;
  /** Uptime after which restart counters reset. Defaults to 300000 ms. */
  stableWindowMs?: number;
  /** Grace period after spawn before a stream is considered live. Defaults to 5000 ms. */
  liveGraceMs?: number;
  /** Kept stderr lines per stream. Defaults to 200. */
  logBufferSize?: number;
}

interface ManagedStream {
  config: StreamConfig;
  child: ChildProcess | null;
  state: StreamState;
  attempt: number;
  restarts: number;
  backoffMs: number;
  startedAt: number | null;
  lastError?: string;
  logs: string[];
  restartTimer?: NodeJS.Timeout;
  liveTimer?: NodeJS.Timeout;
  stableTimer?: NodeJS.Timeout;
}

export interface StreamEventPayload {
  id: string;
  pid?: number;
  attempt?: number;
  delayMs?: number;
  error?: string;
}

export class StreamManager extends EventEmitter {
  private readonly streams = new Map<string, ManagedStream>();
  private readonly maxRestarts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly stableWindowMs: number;
  private readonly liveGraceMs: number;
  private readonly logBufferSize: number;

  constructor(options: StreamManagerOptions = {}) {
    super();
    this.maxRestarts = options.maxRestarts ?? 20;
    this.baseBackoffMs = options.baseBackoffMs ?? 2000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60000;
    this.stableWindowMs = options.stableWindowMs ?? 300000;
    this.liveGraceMs = options.liveGraceMs ?? 5000;
    this.logBufferSize = options.logBufferSize ?? 200;
  }

  /** Start (or reconfigure and start) a stream. Idempotent while running. */
  async start(config: StreamConfig): Promise<StreamStatus> {
    let managed = this.streams.get(config.id);
    if (managed && (managed.state === 'starting' || managed.state === 'live' || managed.state === 'reconnecting')) {
      managed.config = config;
      const status = this.getStatus(config.id);
      if (!status) throw new Error(`Stream "${config.id}" disappeared unexpectedly`);
      return status;
    }
    if (!managed) {
      managed = {
        config,
        child: null,
        state: 'idle',
        attempt: 0,
        restarts: 0,
        backoffMs: this.baseBackoffMs,
        startedAt: null,
        logs: [],
      };
      this.streams.set(config.id, managed);
    } else {
      managed.config = config;
      managed.restarts = 0;
      managed.backoffMs = this.baseBackoffMs;
      managed.lastError = undefined;
    }
    this.launch(managed);
    const status = this.getStatus(config.id);
    if (!status) throw new Error(`Stream "${config.id}" failed to start`);
    return status;
  }

  /** Stop a stream gracefully (SIGTERM, then SIGKILL after timeoutMs). */
  async stop(streamId: string, timeoutMs = 5000): Promise<void> {
    const managed = this.streams.get(streamId);
    if (!managed) return;
    this.clearTimers(managed);
    managed.state = 'stopped';
    const child = managed.child;
    managed.child = null;
    if (child && child.exitCode === null && !child.killed) {
      await this.terminate(child, timeoutMs);
    }
    this.emit('stop', { id: streamId } satisfies StreamEventPayload);
  }

  /** Stop and start a stream again, resetting restart counters. */
  async restart(streamId: string): Promise<StreamStatus> {
    const managed = this.streams.get(streamId);
    if (!managed) throw new Error(`Unknown stream: ${streamId}`);
    await this.stop(streamId);
    managed.restarts = 0;
    managed.backoffMs = this.baseBackoffMs;
    managed.lastError = undefined;
    this.launch(managed);
    const status = this.getStatus(streamId);
    if (!status) throw new Error(`Stream "${streamId}" failed to restart`);
    return status;
  }

  /** Stop a stream and forget it entirely. */
  async remove(streamId: string): Promise<void> {
    await this.stop(streamId);
    this.streams.delete(streamId);
  }

  getStatus(streamId: string): StreamStatus | undefined {
    const managed = this.streams.get(streamId);
    if (!managed) return undefined;
    return {
      id: managed.config.id,
      name: managed.config.name,
      state: managed.state,
      pid: managed.child?.pid,
      startedAt: managed.startedAt ? new Date(managed.startedAt).toISOString() : undefined,
      uptimeSec: managed.startedAt ? Math.max(0, Math.floor((Date.now() - managed.startedAt) / 1000)) : 0,
      restarts: managed.restarts,
      lastError: managed.lastError,
      destination: joinRtmpUrl(managed.config.rtmpUrl, '***'),
    };
  }

  listStreams(): StreamStatus[] {
    return [...this.streams.keys()]
      .map((id) => this.getStatus(id))
      .filter((s): s is StreamStatus => s !== undefined);
  }

  /** Last stderr lines captured for a stream (newest last). */
  getLogs(streamId: string, limit = 100): string[] {
    const managed = this.streams.get(streamId);
    if (!managed) return [];
    return managed.logs.slice(-Math.max(1, limit));
  }

  /** Liveness check: known stream, in a running state, process alive. */
  healthCheck(streamId: string): { healthy: boolean; reason?: string } {
    const managed = this.streams.get(streamId);
    if (!managed) return { healthy: false, reason: 'unknown stream' };
    if (managed.state === 'stopped' || managed.state === 'idle') {
      return { healthy: true, reason: `state=${managed.state}` };
    }
    if (managed.state === 'error') {
      return { healthy: false, reason: managed.lastError ?? 'stream in error state' };
    }
    if (managed.child && managed.child.exitCode === null && !managed.child.killed) {
      return { healthy: true };
    }
    return { healthy: false, reason: 'ffmpeg process not running' };
  }

  /** Stop every managed stream. Used on service shutdown. */
  async shutdown(timeoutMs = 5000): Promise<void> {
    await Promise.all([...this.streams.keys()].map((id) => this.stop(id, timeoutMs)));
  }

  // ---------------------------------------------------------------- internals

  private launch(managed: ManagedStream): void {
    managed.attempt += 1;
    const attempt = managed.attempt;
    managed.state = managed.restarts > 0 ? 'reconnecting' : 'starting';
    managed.lastError = undefined;

    let spawned;
    try {
      spawned = buildLoopCommand(managed.config);
    } catch (err) {
      managed.state = 'error';
      managed.lastError = err instanceof Error ? err.message : String(err);
      this.pushLog(managed, `failed to spawn ffmpeg: ${managed.lastError}`);
      this.emit('error', { id: managed.config.id, error: managed.lastError } satisfies StreamEventPayload);
      return;
    }

    const child = spawned.process;
    managed.child = child;
    managed.startedAt = Date.now();
    this.pushLog(managed, `ffmpeg spawned (pid ${child.pid}) -> ${spawned.destination}`);
    this.emit('start', { id: managed.config.id, pid: child.pid, attempt } satisfies StreamEventPayload);

    child.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n')) {
        const trimmed = line.trim();
        if (trimmed) this.pushLog(managed, trimmed);
      }
    });
    child.once('error', (err) => {
      if (managed.attempt !== attempt) return;
      managed.lastError = `spawn error: ${err.message}`;
      this.pushLog(managed, managed.lastError);
      this.handleExit(managed, 1, null, attempt);
    });
    child.once('exit', (code, signal) => {
      if (managed.attempt !== attempt) return;
      this.handleExit(managed, code, signal, attempt);
    });

    // Consider the stream live once the process survives the grace period.
    managed.liveTimer = setTimeout(() => {
      if (managed.attempt !== attempt) return;
      if (managed.child === child && managed.state !== 'stopped') {
        managed.state = 'live';
        this.emit('live', { id: managed.config.id, pid: child.pid, attempt } satisfies StreamEventPayload);
        // Reset backoff after a sustained stable window.
        managed.stableTimer = setTimeout(() => {
          if (managed.attempt !== attempt) return;
          managed.restarts = 0;
          managed.backoffMs = this.baseBackoffMs;
        }, this.stableWindowMs);
        managed.stableTimer.unref?.();
      }
    }, this.liveGraceMs);
    managed.liveTimer.unref?.();
  }

  private handleExit(
    managed: ManagedStream,
    code: number | null,
    signal: NodeJS.Signals | null,
    attempt: number,
  ): void {
    if (managed.attempt !== attempt) return;
    managed.child = null;
    this.clearTimers(managed, true);

    // Intentional stop: nothing to do.
    if (managed.state === 'stopped') {
      this.pushLog(managed, 'ffmpeg exited after intentional stop');
      return;
    }

    const detail = `ffmpeg exited (code=${code ?? 'n/a'}, signal=${signal ?? 'n/a'})`;
    this.pushLog(managed, detail);
    if (!managed.lastError) managed.lastError = detail;

    if (managed.restarts >= this.maxRestarts) {
      managed.state = 'error';
      this.emit('failed', {
        id: managed.config.id,
        attempt,
        error: `max restarts (${this.maxRestarts}) reached: ${managed.lastError}`,
      } satisfies StreamEventPayload);
      return;
    }

    managed.state = 'reconnecting';
    managed.restarts += 1;
    const delay = Math.min(managed.backoffMs, this.maxBackoffMs);
    managed.backoffMs = Math.min(managed.backoffMs * 2, this.maxBackoffMs);
    this.pushLog(managed, `reconnecting in ${delay}ms (attempt ${managed.restarts})`);
    this.emit('reconnecting', {
      id: managed.config.id,
      attempt: managed.restarts,
      delayMs: delay,
      error: managed.lastError,
    } satisfies StreamEventPayload);
    managed.restartTimer = setTimeout(() => this.launch(managed), delay);
    managed.restartTimer.unref?.();
  }

  private terminate(child: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
        finish();
      }, timeoutMs);
      timer.unref?.();
      child.once('exit', finish);
      try {
        // 'q' via stdin is not available (stdin ignored); SIGTERM is the clean stop.
        child.kill('SIGTERM');
      } catch {
        finish();
      }
    });
  }

  private clearTimers(managed: ManagedStream, keepRestart = false): void {
    if (managed.liveTimer) clearTimeout(managed.liveTimer);
    if (managed.stableTimer) clearTimeout(managed.stableTimer);
    if (!keepRestart && managed.restartTimer) clearTimeout(managed.restartTimer);
    managed.liveTimer = undefined;
    managed.stableTimer = undefined;
    if (!keepRestart) managed.restartTimer = undefined;
  }

  private pushLog(managed: ManagedStream, line: string): void {
    managed.logs.push(`[${new Date().toISOString()}] ${line}`);
    if (managed.logs.length > this.logBufferSize) {
      managed.logs.splice(0, managed.logs.length - this.logBufferSize);
    }
  }
}
