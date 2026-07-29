import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { kvStore } from '@lib/kvStore';
import { AppError } from '@middleware/error-handler';

export async function enforceRateLimit(options: {
  key: string;
  limit: number;
  windowSeconds: number;
  message?: string;
  code?: string;
}): Promise<void> {
  const count = await kvStore.incr(options.key, options.windowSeconds);
  if (count > options.limit) {
    throw new AppError(
      429,
      options.message ?? 'Too many requests. Please try again later.',
      options.code ?? 'RATE_LIMITED',
    );
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateJti(): string {
  return randomUUID();
}
