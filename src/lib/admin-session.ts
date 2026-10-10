import { env } from '@config/env';
import { signAdminAccessToken } from '@lib/admin-jwt';
import { prisma } from '@lib/prisma';
import { generateOpaqueToken, hashToken } from '@lib/rateLimiter';
import { AppError } from '@middleware/error-handler';

export async function createAdminSession(adminUserId: string, meta: { userAgent?: string; ip?: string }) {
  const refreshToken = generateOpaqueToken();
  const now = new Date();
  const session = await prisma.adminSession.create({
    data: {
      adminUserId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt: new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000),
      lastActivityAt: now,
    },
  });
  const accessToken = await signAdminAccessToken({
    sub: adminUserId,
    sessionId: session.id,
  });
  return { accessToken, refreshToken, sessionId: session.id };
}

export function adminSessionIdleMs(): number {
  return env.adminSessionIdleSeconds * 1000;
}

export async function assertAdminSessionActive(session: {
  id: string;
  revoked: boolean;
  expiresAt: Date;
  lastActivityAt: Date;
}) {
  const now = Date.now();
  if (session.revoked || session.expiresAt.getTime() <= now) {
    throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
  }
  const idleMs = adminSessionIdleMs();
  if (now - session.lastActivityAt.getTime() > idleMs) {
    await prisma.adminSession.update({
      where: { id: session.id },
      data: { revoked: true },
    });
    throw new AppError(401, 'Session expired due to inactivity', 'SESSION_IDLE_TIMEOUT');
  }
}

/** Touch activity at most once per minute to limit writes on the hot path. */
export async function touchAdminSessionActivity(session: { id: string; lastActivityAt: Date }) {
  const now = Date.now();
  if (now - session.lastActivityAt.getTime() < 60_000) {
    return;
  }
  await prisma.adminSession.update({
    where: { id: session.id },
    data: { lastActivityAt: new Date(now) },
  });
}

export async function revokeOtherAdminSessions(adminUserId: string, keepSessionId: string) {
  await prisma.adminSession.updateMany({
    where: { adminUserId, revoked: false, id: { not: keepSessionId } },
    data: { revoked: true },
  });
}

export async function revokeAllAdminSessions(adminUserId: string) {
  await prisma.adminSession.updateMany({
    where: { adminUserId, revoked: false },
    data: { revoked: true },
  });
}
