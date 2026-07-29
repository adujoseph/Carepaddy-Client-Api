import { z } from '@docs/zod-extend';
import { registry } from '@docs/registry';

export const HealthResponseSchema = registry.register(
  'HealthResponse',
  z.object({
    status: z.literal('ok'),
    service: z.string(),
    timestamp: z.iso.datetime(),
  }),
);

export const HealthReadyResponseSchema = registry.register(
  'HealthReadyResponse',
  z.object({
    status: z.literal('ok'),
    database: z.literal('connected'),
  }),
);

export const HealthReadyErrorSchema = registry.register(
  'HealthReadyError',
  z.object({
    status: z.literal('error'),
    database: z.literal('unreachable'),
  }),
);
