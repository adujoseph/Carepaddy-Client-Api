import { prisma } from '@lib/prisma';
import { signAccessToken } from '@lib/jwt';
import { generateOpaqueToken, hashToken } from '@lib/rateLimiter';
import { verifyPasswordConstantTime } from '@lib/password';
import { isEmailLike, normalizeEmail, normalizePhone } from '@lib/normalize';
import { AppError } from '@middleware/error-handler';
import { env } from '@config/env';
import type { LoginInput } from './session.schema.js';

const GENERIC_LOGIN_ERROR = 'Invalid login details or account unavailable';
const LOCK_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FAILED = 5;

export async function createSessionForUser(options: {
  userId: string;
  userRole: 'care_admin' | 'care_staff' | 'guardian';
  tenantId: string | null;
  userAgent?: string;
  ip?: string;
}) {
  const refreshToken = generateOpaqueToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId: options.userId,
      refreshTokenHash,
      userAgent: options.userAgent,
      ip: options.ip,
      expiresAt,
    },
  });

  const accessToken = await signAccessToken({
    sub: options.userId,
    userRole: options.userRole,
    sessionId: session.id,
    tenantId: options.tenantId,
  });

  return { accessToken, refreshToken, sessionId: session.id };
}

export async function login(
  input: LoginInput,
  meta: { userAgent?: string; ip?: string },
) {
  const identifier = input.identifier.trim();
  const lookup = isEmailLike(identifier)
    ? { email: normalizeEmail(identifier) }
    : { phone: normalizePhone(identifier) };

  const user = await prisma.user.findFirst({
    where: lookup,
    include: {
      carehome: true,
      guardianLinks: {
        include: {
          resident: true,
          carehome: true,
        },
      },
    },
  });

  if (user) {
    const recentFailures = await prisma.failedLoginAttempt.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: new Date(Date.now() - LOCK_WINDOW_MS) },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (recentFailures.length >= MAX_FAILED) {
      const fifth = recentFailures[MAX_FAILED - 1];
      if (fifth && Date.now() - fifth.createdAt.getTime() < LOCKOUT_MS) {
        throw new AppError(423, 'Account temporarily locked. Try again later.', 'ACCOUNT_LOCKED');
      }
    }
  }

  const passwordOk = await verifyPasswordConstantTime(user?.password, input.password);

  if (!user || !passwordOk) {
    if (user) {
      await prisma.failedLoginAttempt.create({ data: { userId: user.id } });
    }
    throw new AppError(401, GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'active') {
    throw new AppError(401, GENERIC_LOGIN_ERROR, 'INVALID_CREDENTIALS');
  }

  await prisma.failedLoginAttempt.deleteMany({ where: { userId: user.id } });

  const tokens = await createSessionForUser({
    userId: user.id,
    userRole: user.userRole,
    tenantId: user.tenantId,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  const baseUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    userType: user.userType,
    userRole: user.userRole,
  };

  if (user.userRole === 'guardian') {
    return {
      user: baseUser,
      residentLinks: user.guardianLinks.map((link) => ({
        residentId: link.residentId,
        residentName: link.resident.name,
        tenantId: link.tenantId,
        carehomeName: link.carehome.name,
        status: link.status,
      })),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  return {
    user: baseUser,
    carehome: user.carehome
      ? {
          id: user.carehome.id,
          name: user.carehome.name,
          cqcCheck: user.carehome.cqcCheck,
          isEmailVerified: user.carehome.isEmailVerified,
          isPhoneVerified: user.carehome.isPhoneVerified,
          status: user.carehome.status,
        }
      : null,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

export async function refresh(refreshToken: string) {
  const tokenHash = hashToken(refreshToken);
  const session = await prisma.session.findFirst({
    where: { refreshTokenHash: tokenHash },
    include: { user: true },
  });

  if (!session) {
    // Possible reuse of an already-rotated token — cannot map to session cheaply
    // without storing prior hashes. Treat as unauthorized.
    throw new AppError(401, 'Invalid or expired refresh token', 'UNAUTHORIZED');
  }

  if (session.revoked || session.expiresAt <= new Date()) {
    throw new AppError(401, 'Invalid or expired refresh token', 'UNAUTHORIZED');
  }

  if (session.user.status !== 'active') {
    await prisma.session.update({
      where: { id: session.id },
      data: { revoked: true },
    });
    throw new AppError(401, 'Invalid or expired refresh token', 'UNAUTHORIZED');
  }

  const newRefreshToken = generateOpaqueToken();
  const newHash = hashToken(newRefreshToken);

  await prisma.session.update({
    where: { id: session.id },
    data: { refreshTokenHash: newHash },
  });

  const accessToken = await signAccessToken({
    sub: session.userId,
    userRole: session.user.userRole,
    sessionId: session.id,
    tenantId: session.user.tenantId,
  });

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(options: {
  userId: string;
  sessionId: string;
  all?: boolean;
}) {
  if (options.all) {
    await prisma.session.updateMany({
      where: { userId: options.userId, revoked: false },
      data: { revoked: true },
    });
    return;
  }

  await prisma.session.updateMany({
    where: { id: options.sessionId, userId: options.userId },
    data: { revoked: true },
  });
}
