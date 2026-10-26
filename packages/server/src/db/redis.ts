// The Redis connection (ioredis). Hot state other processes will read (presence, zone membership, the clock) is mirrored
// here as later tasks add it (docs/ARCHITECTURE.md §1); in this task it backs the health check.
import { Redis } from 'ioredis';
import { withTimeout } from './client.ts';

export interface RedisHandle {
  redis: Redis;
  ping(timeoutMs?: number): Promise<boolean>;
  close(): Promise<void>;
}

export async function connectRedis(url: string, onError: (err: Error) => void): Promise<RedisHandle> {
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5000 });
  // ioredis reconnects on its own; report the first error of each outage, not every retry.
  let down = false;
  redis.on('error', (err: Error) => {
    if (!down) onError(err);
    down = true;
  });
  redis.on('ready', () => {
    down = false;
  });
  try {
    await redis.connect();
  } catch (err) {
    redis.disconnect();
    throw err;
  }
  return {
    redis,
    ping: (timeoutMs = 2000) =>
      withTimeout(
        redis.ping().then((r) => r === 'PONG'),
        timeoutMs,
        false,
      ),
    close: async () => {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    },
  };
}
