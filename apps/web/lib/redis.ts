// General-purpose Redis client singleton for the Next.js app.
// Used for pub/sub and lightweight caching. BullMQ owns its own dedicated
// connections inside @dashboard/queue (it requires maxRetriesPerRequest: null).

import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  __dashboardRedis?: Redis;
};

function createRedis(): Redis {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    // General app usage keeps retry behavior enabled.
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on('error', (err: Error) => {
    console.error(`[redis] connection error: ${err.message}`);
  });

  return redis;
}

export const redis: Redis =
  globalForRedis.__dashboardRedis ?? createRedis();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.__dashboardRedis = redis;
}

export default redis;
