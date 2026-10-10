import { prisma } from '@lib/prisma';
import type { Prisma } from '../../generated/prisma/client.js';

const SECRET_KEYS = new Set([
  'password',
  'token',
  'refreshToken',
  'accessToken',
  'secret',
  'totpCode',
  'recoveryCode',
  'captchaToken',
  'challengeToken',
]);

function sanitizeState(state: unknown): unknown {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return state;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export async function writeAdminAuditLog(options: {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
}) {
  await prisma.adminAuditLog.create({
    data: {
      actorId: options.actorId,
      action: options.action,
      targetType: options.targetType,
      targetId: options.targetId ?? null,
      beforeState: options.beforeState
        ? (sanitizeState(options.beforeState) as Prisma.InputJsonValue)
        : undefined,
      afterState: options.afterState
        ? (sanitizeState(options.afterState) as Prisma.InputJsonValue)
        : undefined,
    },
  });
}
