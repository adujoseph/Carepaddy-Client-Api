import { z } from '@docs/zod-extend';
import { cqcProvider } from '../../../providers/cqc.provider.js';
import { enforceRateLimit } from '@lib/rateLimiter';

export const cqcLookupSchema = z.object({
  cqcNumber: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200).optional(),
  postcode: z.string().trim().min(2).max(20).optional(),
});

export type CqcLookupInput = z.infer<typeof cqcLookupSchema>;

export async function lookupCqc(input: CqcLookupInput, ip: string) {
  await enforceRateLimit({
    key: `cqc:ip:${ip || 'unknown'}`,
    limit: 10,
    windowSeconds: 60,
    message: 'Too many requests. Please try again later.',
    code: 'RATE_LIMITED',
  });

  const result = await cqcProvider.verify({
    cqcNumber: input.cqcNumber,
    name: input.name ?? '',
    postcode: input.postcode ?? '',
  });

  return {
    valid: result.valid,
    providerName: result.providerName,
    location: result.location,
  };
}
