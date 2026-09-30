/**
 * Standalone 24/7 auto-live streaming service.
 *
 * - Loads stream configs from a JSON file (STREAMS_CONFIG, default ./streams.json).
 * - Supervises every enabled stream with StreamManager (auto-restart, backoff).
 * - Exposes a tiny HTTP API for health checks and stream control.
 * - Graceful shutdown on SIGINT / SIGTERM.
 *
 * Run:  node ./dist/server.js
 * Env:  STREAM_PORT (default 8090), STREAMS_CONFIG (default ./streams.json)
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { StreamManager } from './manager';
import type { StreamConfig } from './types';
import { validateStreamConfig } from './ffmpeg';
import { checkBinaries } from './utils';

const PORT = Number(process.env.STREAM_PORT ?? 8090);
const CONFIG_PATH = process.env.STREAMS_CONFIG ?? './streams.json';
const BOOT_TIME = Date.now();

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `[${new Date().toISOString()}] [streaming] [${level}] ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

async function loadConfigs(): Promise<StreamConfig[]> {
  if (!existsSync(CONFIG_PATH)) {
    log('warn', `config file not found at ${CONFIG_PATH}; starting with no streams`);
    return [];
  }
  const raw = await readFile(CONFIG_PATH, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${CONFIG_PATH}: ${(err as Error).message}`);
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { streams?: unknown }).streams;
  if (!Array.isArray(list)) {
    throw new Error(`Expected an array of stream configs in ${CONFIG_PATH}`);
  }
  return list as StreamConfig[];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

async function main(): Promise<void> {
  const binaries = await checkBinaries();
  if (!binaries.ffmpeg) {
    log('error', 'ffmpeg binary not found. Install ffmpeg or set FFMPEG_PATH.');
  }
  if (!binaries.ffprobe) {
    log('warn', 'ffprobe binary not found. Video probing will be unavailable.');
  }

  const manager = new StreamManager({
    baseBackoffMs: Number(process.env.STREAM_BACKOFF_MS ?? 2000),
    maxBackoffMs: Number(process.env.STREAM_MAX_BACKOFF_MS ?? 60000),
    maxRestarts: Number(process.env.STREAM_MAX_RESTARTS ?? 20),
  });

  manager.on('start', (p: { id: string; pid?: number }) => log('info', `stream "${p.id}" starting (pid ${p.pid})`));
  manager.on('live', (p: { id: string }) => log('info', `stream "${p.id}" is live`));
  manager.on('reconnecting', (p: { id: string; attempt?: number; delayMs?: number; error?: string }) =>
    log('warn', `stream "${p.id}" reconnecting (attempt ${p.attempt}, in ${p.delayMs}ms): ${p.error}`));
  manager.on('stop', (p: { id: string }) => log('info', `stream "${p.id}" stopped`));
  manager.on('error', (p: { id: string; error?: string }) => log('error', `stream "${p.id}" error: ${p.error}`));
  manager.on('failed', (p: { id: string; error?: string }) => log('error', `stream "${p.id}" failed: ${p.error}`));

  // Boot: start every enabled stream from config.
  const configs = await loadConfigs();
  for (const config of configs) {
    if (config.enabled === false) {
      log('info', `stream "${config.id}" disabled, skipping`);
      continue;
    }
    try {
      validateStreamConfig(config);
      await manager.start(config);
    } catch (err) {
      log('error', `could not start stream "${config.id}": ${(err as Error).message}`);
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && url.pathname === '/health') {
        const streams = manager.listStreams().map((s) => ({
          ...s,
          healthy: manager.healthCheck(s.id).healthy,
        }));
        sendJson(res, 200, {
          status: 'ok',
          uptimeSec: Math.floor((Date.now() - BOOT_TIME) / 1000),
          binaries,
          streams,
        });
        return;
      }

      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'streams') {
        sendJson(res, 200, { streams: manager.listStreams() });
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'streams') {
        const status = manager.getStatus(parts[1]);
        if (!status) {
          sendJson(res, 404, { error: `unknown stream: ${parts[1]}` });
          return;
        }
        const logs = url.searchParams.get('logs');
        sendJson(res, 200, {
          ...status,
          health: manager.healthCheck(parts[1]),
          ...(logs ? { logs: manager.getLogs(parts[1], Number(logs) || 100) } : {}),
        });
        return;
      }

      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'streams') {
        const body = await readBody(req);
        const config = JSON.parse(body) as StreamConfig;
        validateStreamConfig(config);
        const status = await manager.start(config);
        sendJson(res, 201, status);
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'streams' && parts[2] === 'stop') {
        await manager.stop(parts[1]);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'streams' && parts[2] === 'restart') {
        const status = await manager.restart(parts[1]);
        sendJson(res, 200, status);
        return;
      }

      if (req.method === 'DELETE' && parts.length === 2 && parts[0] === 'streams') {
        await manager.remove(parts[1]);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
    }
  });

  server.listen(PORT, () => {
    log('info', `streaming service listening on port ${PORT}`);
  });

  const shutdown = async (): Promise<void> => {
    log('info', 'shutting down streaming service');
    server.close();
    await manager.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  log('error', `fatal: ${(err as Error).message}`);
  process.exit(1);
});
