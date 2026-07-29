import { Router } from 'express';
import { registry } from '@docs/registry';
import {
  HealthReadyErrorSchema,
  HealthReadyResponseSchema,
  HealthResponseSchema,
} from '@modules/health/health.schema';
import { logger } from '@lib/logger';
import { prisma } from '@lib/prisma';

export const healthRouter = Router();

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Liveness check',
  responses: {
    200: {
      description: 'Service is running',
      content: {
        'application/json': { schema: HealthResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/health/ready',
  tags: ['System'],
  summary: 'Readiness check (database connectivity)',
  responses: {
    200: {
      description: 'Database is reachable',
      content: {
        'application/json': { schema: HealthReadyResponseSchema },
      },
    },
    503: {
      description: 'Database is unreachable',
      content: {
        'application/json': { schema: HealthReadyErrorSchema },
      },
    },
  },
});

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'client-api',
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (err) {
    logger.warn({ err }, 'database readiness check failed');
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});
