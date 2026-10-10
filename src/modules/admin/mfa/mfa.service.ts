import * as jose from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import { decryptAdminSecret, encryptAdminSecret } from '@lib/admin-crypto';
import { verifyAdminMfaChallengeToken } from '@lib/admin-jwt';
import { prisma } from '@lib/prisma';
import { verifyPasswordConstantTime } from '@lib/password';
import { AppError } from '@middleware/error-handler';
import { writeAdminAuditLog } from '../audit.service.js';
import { loadAdminContext, serializeAdminMe } from '../admin-context.js';
import { SUPER_ADMIN_ROLE_NAME } from '../permissions.js';
import { createAdminSession } from '@lib/admin-session.js';
import { adminLoginProgressiveDelay, recordAdminLoginFailure } from '../auth/login-security.js';

const RECOVERY_CODE_COUNT = 10;

function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    codes.push(randomBytes(5).toString('hex').toUpperCase());
  }
  return codes;
}

async function loadTotpSecret(adminUserId: string): Promise<string | null> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin?.mfaTotpSecretEnc || !admin.mfaEnrolledAt) return null;
  return decryptAdminSecret(admin.mfaTotpSecretEnc);
}

async function verifyTotpForAdmin(adminUserId: string, totpCode: string): Promise<boolean> {
  const secret = await loadTotpSecret(adminUserId);
  if (!secret) return false;
  const result = await verify({ secret, token: totpCode.replace(/\s/g, '') });
  return result.valid === true;
}

async function verifyRecoveryCodeForAdmin(adminUserId: string, recoveryCode: string): Promise<boolean> {
  const hash = hashRecoveryCode(recoveryCode);
  const row = await prisma.adminMfaRecoveryCode.findFirst({
    where: { adminUserId, codeHash: hash, usedAt: null },
  });
  if (!row) return false;
  await prisma.adminMfaRecoveryCode.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  });
  await prisma.adminUser.update({
    where: { id: adminUserId },
    data: { mfaRecoveryRegenRequired: true },
  });
  return true;
}

export async function startMfaEnrollment(adminUserId: string, currentPassword: string) {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminUserId },
    include: { role: true },
  });
  if (!admin) {
    throw new AppError(404, 'Admin not found', 'NOT_FOUND');
  }
  if (admin.mfaEnrolledAt) {
    throw new AppError(409, 'MFA is already enrolled', 'MFA_ALREADY_ENROLLED');
  }

  const ok = await verifyPasswordConstantTime(admin.password, currentPassword);
  if (!ok) {
    throw new AppError(400, 'Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  }

  const secret = generateSecret();
  const pendingEnc = encryptAdminSecret(secret);

  await prisma.adminUser.update({
    where: { id: adminUserId },
    data: { mfaTotpSecretEnc: pendingEnc },
  });

  const otpauthUrl = generateURI({
    issuer: 'CarePaddy Admin',
    label: admin.email,
    secret,
  });

  return { secret, otpauthUrl };
}

export async function confirmMfaEnrollment(adminUserId: string, totpCode: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin?.mfaTotpSecretEnc) {
    throw new AppError(400, 'Start MFA enrollment first', 'MFA_ENROLLMENT_REQUIRED');
  }
  if (admin.mfaEnrolledAt) {
    throw new AppError(409, 'MFA is already enrolled', 'MFA_ALREADY_ENROLLED');
  }

  const secret = decryptAdminSecret(admin.mfaTotpSecretEnc);
  const result = await verify({ secret, token: totpCode.replace(/\s/g, '') });
  if (!result.valid) {
    throw new AppError(400, 'Invalid authenticator code', 'INVALID_TOTP');
  }

  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.adminMfaRecoveryCode.deleteMany({ where: { adminUserId } });
    await tx.adminMfaRecoveryCode.createMany({
      data: recoveryCodes.map((code) => ({
        adminUserId,
        codeHash: hashRecoveryCode(code),
      })),
    });
    await tx.adminUser.update({
      where: { id: adminUserId },
      data: {
        mfaEnrolledAt: new Date(),
        mfaRecoveryRegenRequired: false,
      },
    });
  });

  await writeAdminAuditLog({
    actorId: adminUserId,
    action: 'auth.mfa.enroll',
    targetType: 'AdminUser',
    targetId: adminUserId,
  });

  return { recoveryCodes, message: 'MFA enabled. Store recovery codes securely — they will not be shown again.' };
}

export async function verifyMfaLogin(
  input: {
    challengeToken: string;
    totpCode?: string;
    recoveryCode?: string;
    captchaToken?: string;
  },
  meta: { userAgent?: string; ip?: string },
) {
  let adminUserId: string;
  try {
    const payload = await verifyAdminMfaChallengeToken(input.challengeToken);
    adminUserId = payload.adminUserId;
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new AppError(410, 'MFA challenge expired. Sign in again.', 'MFA_CHALLENGE_EXPIRED');
    }
    throw new AppError(400, 'Invalid MFA challenge', 'INVALID_MFA_CHALLENGE');
  }

  const ip = meta.ip ?? 'unknown';
  await adminLoginProgressiveDelay(adminUserId, ip, input.captchaToken);

  let verified = false;
  if (input.totpCode) {
    verified = await verifyTotpForAdmin(adminUserId, input.totpCode);
  } else if (input.recoveryCode) {
    verified = await verifyRecoveryCodeForAdmin(adminUserId, input.recoveryCode);
  }

  if (!verified) {
    await recordAdminLoginFailure(adminUserId, ip, 'auth.login.mfa_failed');
    throw new AppError(401, 'Invalid MFA code', 'INVALID_MFA');
  }

  await prisma.adminFailedLoginAttempt.deleteMany({
    where: { OR: [{ adminUserId }, { ip }] },
  });

  const tokens = await createAdminSession(adminUserId, meta);
  const ctx = await loadAdminContext(adminUserId);

  await writeAdminAuditLog({
    actorId: adminUserId,
    action: input.recoveryCode ? 'auth.login.mfa_recovery' : 'auth.login.success',
    targetType: 'AdminUser',
    targetId: adminUserId,
  });

  return {
    ...tokens,
    me: ctx ? serializeAdminMe(ctx) : null,
  };
}

export async function regenerateRecoveryCodes(adminUserId: string, currentPassword: string, totpCode: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  if (!admin?.mfaEnrolledAt) {
    throw new AppError(400, 'MFA is not enrolled', 'MFA_NOT_ENROLLED');
  }

  const ok = await verifyPasswordConstantTime(admin.password, currentPassword);
  if (!ok) {
    throw new AppError(400, 'Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  }

  if (!(await verifyTotpForAdmin(adminUserId, totpCode))) {
    throw new AppError(400, 'Invalid authenticator code', 'INVALID_TOTP');
  }

  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.adminMfaRecoveryCode.deleteMany({ where: { adminUserId } });
    await tx.adminMfaRecoveryCode.createMany({
      data: recoveryCodes.map((code) => ({
        adminUserId,
        codeHash: hashRecoveryCode(code),
      })),
    });
    await tx.adminUser.update({
      where: { id: adminUserId },
      data: { mfaRecoveryRegenRequired: false },
    });
  });

  await writeAdminAuditLog({
    actorId: adminUserId,
    action: 'auth.mfa.recovery.regenerate',
    targetType: 'AdminUser',
    targetId: adminUserId,
  });

  return { recoveryCodes };
}

export async function removeMfaSelf(
  adminUserId: string,
  input: { currentPassword: string; totpCode?: string; recoveryCode?: string },
) {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminUserId },
    include: { role: true },
  });
  if (!admin?.mfaEnrolledAt) {
    throw new AppError(400, 'MFA is not enrolled', 'MFA_NOT_ENROLLED');
  }
  if (admin.role.name.toUpperCase() === SUPER_ADMIN_ROLE_NAME) {
    throw new AppError(403, 'SUPER_ADMIN accounts must keep MFA enabled', 'MFA_REQUIRED');
  }

  const ok = await verifyPasswordConstantTime(admin.password, input.currentPassword);
  if (!ok) {
    throw new AppError(400, 'Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  }

  let verified = false;
  if (input.totpCode) {
    verified = await verifyTotpForAdmin(adminUserId, input.totpCode);
  } else if (input.recoveryCode) {
    verified = await verifyRecoveryCodeForAdmin(adminUserId, input.recoveryCode);
  }
  if (!verified) {
    throw new AppError(400, 'Invalid MFA verification', 'INVALID_MFA');
  }

  await clearMfaForAdmin(adminUserId);

  await writeAdminAuditLog({
    actorId: adminUserId,
    action: 'auth.mfa.remove.self',
    targetType: 'AdminUser',
    targetId: adminUserId,
  });

  return { message: 'MFA removed' };
}

export async function removeMfaForAdminByActor(targetId: string, actorId: string) {
  const admin = await prisma.adminUser.findUnique({ where: { id: targetId } });
  if (!admin?.mfaEnrolledAt) {
    throw new AppError(400, 'Target admin does not have MFA enrolled', 'MFA_NOT_ENROLLED');
  }

  await clearMfaForAdmin(targetId);

  await writeAdminAuditLog({
    actorId,
    action: 'auth.mfa.remove.admin',
    targetType: 'AdminUser',
    targetId,
  });

  return { message: 'MFA removed for admin' };
}

async function clearMfaForAdmin(adminUserId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.adminMfaRecoveryCode.deleteMany({ where: { adminUserId } });
    await tx.adminUser.update({
      where: { id: adminUserId },
      data: {
        mfaTotpSecretEnc: null,
        mfaEnrolledAt: null,
        mfaRecoveryRegenRequired: false,
      },
    });
  });
}

export async function adminHasMfaEnrolled(adminUserId: string): Promise<boolean> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminUserId } });
  return Boolean(admin?.mfaEnrolledAt);
}
