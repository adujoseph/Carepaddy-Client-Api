import * as jose from 'jose';
import { env } from '@config/env';
import { prisma } from '@lib/prisma';
import {
  signAdminMfaChallengeToken,
  signAdminPasswordResetToken,
  verifyAdminInviteToken,
  verifyAdminPasswordResetToken,
} from '@lib/admin-jwt';
import {
  createAdminSession,
  revokeAllAdminSessions,
  revokeOtherAdminSessions,
} from '@lib/admin-session';
import { normalizeEmail } from '@lib/normalize';
import { assertPasswordPolicy, hashPassword, verifyPasswordConstantTime } from '@lib/password';
import { generateJti } from '@lib/rateLimiter';
import { AppError } from '@middleware/error-handler';
import { emailSender } from '../../../providers/notify.js';
import { logger } from '@lib/logger';
import { loadAdminContext, serializeAdminMe } from '../admin-context.js';
import { writeAdminAuditLog } from '../audit.service.js';
import { adminHasMfaEnrolled } from '../mfa/mfa.service.js';
import {
  adminLoginProgressiveDelay,
  recordAdminLoginFailure,
} from './login-security.js';
import type {
  AcceptAdminInviteInput,
  AdminChangePasswordInput,
  AdminForgotPasswordInput,
  AdminLoginInput,
  AdminResetPasswordInput,
} from './auth.schema.js';

const GENERIC_LOGIN = 'Invalid login details or account unavailable';
const GENERIC_RESET = "If this email is registered, you'll receive a reset link shortly.";

export async function adminLogin(input: AdminLoginInput, meta: { userAgent?: string; ip?: string }) {
  const email = normalizeEmail(input.email);
  const ip = meta.ip ?? 'unknown';

  const admin = await prisma.adminUser.findUnique({
    where: { emailLower: email },
    include: { role: true },
  });

  await adminLoginProgressiveDelay(admin?.id, ip, input.captchaToken);

  const passwordOk = await verifyPasswordConstantTime(admin?.password, input.password);

  if (!admin || !passwordOk) {
    await recordAdminLoginFailure(admin?.id, ip);
    throw new AppError(401, GENERIC_LOGIN, 'INVALID_CREDENTIALS');
  }

  if (admin.status === 'DEACTIVATED') {
    await writeAdminAuditLog({
      actorId: admin.id,
      action: 'auth.login.deactivated',
      targetType: 'AdminUser',
      targetId: admin.id,
    });
    throw new AppError(
      403,
      'Account deactivated. Contact your super admin.',
      'ACCOUNT_DEACTIVATED',
    );
  }

  await prisma.adminFailedLoginAttempt.deleteMany({
    where: { OR: [{ adminUserId: admin.id }, { ip }] },
  });

  const ctx = await loadAdminContext(admin.id);
  if (!ctx) {
    throw new AppError(500, 'Admin profile unavailable', 'INTERNAL_ERROR');
  }

  if (await adminHasMfaEnrolled(admin.id)) {
    const challengeToken = await signAdminMfaChallengeToken(admin.id);
    await writeAdminAuditLog({
      actorId: admin.id,
      action: 'auth.login.mfa_required',
      targetType: 'AdminUser',
      targetId: admin.id,
    });
    return {
      mfaRequired: true as const,
      challengeToken,
      me: serializeAdminMe(ctx),
    };
  }

  const tokens = await createAdminSession(admin.id, meta);

  await writeAdminAuditLog({
    actorId: admin.id,
    action: 'auth.login.success',
    targetType: 'AdminUser',
    targetId: admin.id,
  });

  return {
    ...tokens,
    me: serializeAdminMe(ctx),
  };
}

export async function adminForgotPassword(input: AdminForgotPasswordInput) {
  const email = normalizeEmail(input.email);
  const admin = await prisma.adminUser.findUnique({ where: { emailLower: email } });

  if (admin && admin.status !== 'DEACTIVATED') {
    const jti = generateJti();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.adminPasswordResetToken.create({
      data: { jti, adminUserId: admin.id, expiresAt },
    });
    const token = await signAdminPasswordResetToken({ jti, adminUserId: admin.id });
    const link = `${env.appPublicUrl}/admin/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await emailSender.send({
        to: email,
        subject: 'Reset your CarePaddy admin password',
        body: `Reset your password (expires in 1 hour): ${link}`,
      });
    } catch (err) {
      logger.warn({ err, email }, 'admin password reset email failed');
    }

    await writeAdminAuditLog({
      actorId: admin.id,
      action: 'auth.password_reset.requested',
      targetType: 'AdminUser',
      targetId: admin.id,
    });
  }

  return { message: GENERIC_RESET };
}

export async function adminResetPasswordConfirm(input: AdminResetPasswordInput) {
  await assertPasswordPolicy(input.newPassword);

  let payload: Awaited<ReturnType<typeof verifyAdminPasswordResetToken>>;
  try {
    payload = await verifyAdminPasswordResetToken(input.token);
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new AppError(410, 'Reset link has expired', 'TOKEN_EXPIRED');
    }
    throw new AppError(400, 'Invalid reset token', 'INVALID_TOKEN');
  }

  const row = await prisma.adminPasswordResetToken.findUnique({ where: { jti: payload.jti } });
  if (!row || row.used || row.expiresAt <= new Date() || row.adminUserId !== payload.adminUserId) {
    throw new AppError(410, 'Invalid or expired reset token', 'INVALID_TOKEN');
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: payload.adminUserId },
      data: {
        password: await hashPassword(input.newPassword),
        mustChangePassword: false,
      },
    });
    await tx.adminPasswordResetToken.update({
      where: { id: row.id },
      data: { used: true },
    });
    await tx.adminSession.updateMany({
      where: { adminUserId: payload.adminUserId, revoked: false },
      data: { revoked: true },
    });
  });

  await writeAdminAuditLog({
    actorId: payload.adminUserId,
    action: 'auth.password_reset.completed',
    targetType: 'AdminUser',
    targetId: payload.adminUserId,
  });

  return { message: 'Password updated successfully' };
}

export async function adminChangePassword(
  adminUserId: string,
  sessionId: string,
  input: AdminChangePasswordInput,
  meta: { userAgent?: string; ip?: string },
) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin) {
    throw new AppError(404, 'Admin not found', 'NOT_FOUND');
  }

  const ok = await verifyPasswordConstantTime(admin.password, input.currentPassword);
  if (!ok) {
    throw new AppError(400, 'Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  }
  if (input.currentPassword === input.newPassword) {
    throw new AppError(400, 'New password must differ from current password', 'PASSWORD_UNCHANGED');
  }

  await assertPasswordPolicy(input.newPassword);

  await prisma.adminUser.update({
    where: { id: adminUserId },
    data: {
      password: await hashPassword(input.newPassword),
      mustChangePassword: false,
    },
  });

  await revokeOtherAdminSessions(adminUserId, sessionId);
  await prisma.adminSession.update({
    where: { id: sessionId },
    data: { revoked: true },
  });

  const tokens = await createAdminSession(adminUserId, meta);
  const ctx = await loadAdminContext(adminUserId);

  await writeAdminAuditLog({
    actorId: adminUserId,
    action: 'auth.password_change',
    targetType: 'AdminUser',
    targetId: adminUserId,
  });

  return {
    ...tokens,
    me: ctx ? serializeAdminMe(ctx) : null,
    message: 'Password updated successfully',
  };
}

export async function revokeAllAdminSessionsForUser(adminUserId: string) {
  await revokeAllAdminSessions(adminUserId);
  await writeAdminAuditLog({
    actorId: adminUserId,
    action: 'auth.sessions.revoke_all',
    targetType: 'AdminUser',
    targetId: adminUserId,
  });
  return { message: 'All sessions revoked' };
}

export async function verifyAdminInvite(token: string) {
  let payload: Awaited<ReturnType<typeof verifyAdminInviteToken>>;
  try {
    payload = await verifyAdminInviteToken(token);
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new AppError(
        410,
        'This invitation has expired. Ask your super admin to resend it.',
        'INVITE_EXPIRED',
      );
    }
    throw new AppError(400, 'Invalid invitation token', 'INVALID_INVITE');
  }

  const row = await prisma.adminInviteToken.findUnique({
    where: { jti: payload.jti },
    include: { adminUser: { include: { role: true } } },
  });

  if (!row || row.adminUserId !== payload.adminUserId) {
    throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
  }
  if (row.used) {
    throw new AppError(409, 'Invitation already used', 'INVITE_USED');
  }
  if (row.expiresAt <= new Date()) {
    throw new AppError(
      410,
      'This invitation has expired. Ask your super admin to resend it.',
      'INVITE_EXPIRED',
    );
  }

  return {
    email: row.adminUser.email,
    name: row.adminUser.name,
    role: row.adminUser.role.name,
  };
}

export async function acceptAdminInvite(
  input: AcceptAdminInviteInput,
  meta: { userAgent?: string; ip?: string },
) {
  await assertPasswordPolicy(input.password);

  let payload: Awaited<ReturnType<typeof verifyAdminInviteToken>>;
  try {
    payload = await verifyAdminInviteToken(input.inviteToken);
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new AppError(
        410,
        'This invitation has expired. Ask your super admin to resend it.',
        'INVITE_EXPIRED',
      );
    }
    throw new AppError(400, 'Invalid invitation token', 'INVALID_INVITE');
  }

  const row = await prisma.adminInviteToken.findUnique({
    where: { jti: payload.jti },
    include: { adminUser: true },
  });

  if (!row || row.adminUserId !== payload.adminUserId) {
    throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
  }
  if (row.used) {
    throw new AppError(409, 'Invitation already used', 'INVITE_USED');
  }
  if (row.expiresAt <= new Date()) {
    throw new AppError(
      410,
      'This invitation has expired. Ask your super admin to resend it.',
      'INVITE_EXPIRED',
    );
  }
  if (row.adminUser.status !== 'INVITED') {
    throw new AppError(409, 'Invitation is no longer valid', 'INVITE_INVALID');
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: row.adminUserId },
      data: {
        password: await hashPassword(input.password),
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });
    await tx.adminInviteToken.update({
      where: { id: row.id },
      data: { used: true, usedAt: new Date() },
    });
  });

  await writeAdminAuditLog({
    actorId: row.adminUserId,
    action: 'auth.invite.accepted',
    targetType: 'AdminUser',
    targetId: row.adminUserId,
  });

  const tokens = await createAdminSession(row.adminUserId, meta);
  const ctx = await loadAdminContext(row.adminUserId);
  return {
    ...tokens,
    me: ctx ? serializeAdminMe(ctx) : null,
  };
}

export async function getAdminMe(adminUserId: string) {
  const ctx = await loadAdminContext(adminUserId);
  if (!ctx) {
    throw new AppError(404, 'Admin not found', 'NOT_FOUND');
  }
  return serializeAdminMe(ctx);
}
