import { verifyCaptchaToken } from '@lib/captcha';
import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import { writeAdminAuditLog } from '../audit.service.js';

const LOCK_WINDOW_MS = 10 * 60 * 1000;
export const CAPTCHA_AFTER = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Escalating delay per recent failures (no permanent lockout). */
export function progressiveDelayMs(recentFailures: number): number {
  if (recentFailures <= 0) return 0;
  const base = 400;
  const delay = base * 2 ** Math.min(recentFailures - 1, 6);
  return Math.min(delay, 30_000);
}

export async function countRecentAdminLoginFailures(adminUserId: string | undefined, ip: string) {
  const since = new Date(Date.now() - LOCK_WINDOW_MS);
  const [accountFailures, ipFailures] = await Promise.all([
    adminUserId
      ? prisma.adminFailedLoginAttempt.count({
          where: { adminUserId, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
    prisma.adminFailedLoginAttempt.count({
      where: { ip, createdAt: { gte: since } },
    }),
  ]);
  return Math.max(accountFailures, ipFailures);
}

export async function requireCaptchaIfNeeded(
  recentFailures: number,
  captchaToken: string | undefined,
  remoteIp?: string,
) {
  if (recentFailures < CAPTCHA_AFTER) return;
  const ok = await verifyCaptchaToken(captchaToken, remoteIp);
  if (!ok) {
    throw new AppError(400, 'CAPTCHA verification required', 'CAPTCHA_REQUIRED');
  }
}

export async function adminLoginProgressiveDelay(
  adminUserId: string | undefined,
  ip: string,
  captchaToken?: string,
) {
  const recentFailures = await countRecentAdminLoginFailures(adminUserId, ip);
  await requireCaptchaIfNeeded(recentFailures, captchaToken, ip);
  const delay = progressiveDelayMs(recentFailures);
  if (delay > 0) {
    await sleep(delay);
  }
  return recentFailures;
}

export async function recordAdminLoginFailure(
  adminUserId: string | undefined,
  ip: string,
  auditAction = 'auth.login.failed',
) {
  await prisma.adminFailedLoginAttempt.create({
    data: { adminUserId, ip },
  });
  await writeAdminAuditLog({
    actorId: adminUserId ?? null,
    action: auditAction,
    targetType: 'AdminUser',
    targetId: adminUserId ?? null,
    afterState: { ip },
  });
}
