import { app } from './app.js';
import { env } from '@config/env';
import { prisma } from '@lib/prisma';
import { disconnectRedis } from '@lib/redis';
import { logger } from '@lib/logger';

const server = app.listen(env.port, '0.0.0.0', () => {
  logger.info(`CarePaddy API listening on 0.0.0.0:${env.port}`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await prisma.$disconnect();
    disconnectRedis();
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
