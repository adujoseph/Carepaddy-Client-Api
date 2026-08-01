import Redis from 'ioredis';
import { env } from '@config/env';
import { logger } from '@lib/logger';

let client: Redis | null = null;

/** Lazily create the Redis client — only when Redis-backed features are enabled. */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      // Avoid endless reconnect spam if Redis is briefly down at boot
      retryStrategy(times) {
        if (times > 10) {
          logger.error('Redis reconnect gave up after 10 attempts');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });

    client.on('error', (err: Error) => {
      logger.error({ err }, 'Redis connection error');
    });

    client.on('connect', () => {
      logger.info('Redis connected');
    });
  }
  return client;
}

export function disconnectRedis(): void {
  if (client) {
    client.disconnect();
    client = null;
  }
}
