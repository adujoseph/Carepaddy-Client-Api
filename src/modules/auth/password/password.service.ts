import { z } from '@docs/zod-extend';
import { env } from '@config/env';
import { prisma } from '@lib/prisma';
import { assertPasswordPolicy, hashPassword } from '@lib/password';
import { generateJti } from '@lib/rateLimiter';
import { signPasswordResetToken, verifyPasswordResetToken } from '@lib/jwt';
import { normalizeEmail } from '@lib/normalize';
import { AppError } from '@middleware/error-handler';
import { emailSender } from '../../../providers/notify.js';
import { logger } from '@lib/logger';

export const resetPasswordSchema = z.object({
  email: z.email(),
});

export const resetPasswordConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12).max(200),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ResetPasswordConfirmInput = z.infer<typeof resetPasswordConfirmSchema>;

const GENERIC_RESET_MESSAGE =
  "If this email is registered, you'll receive a reset link shortly.";

export async function initiatePasswordReset(input: ResetPasswordInput): Promise<{ message: string }> {
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return { message: GENERIC_RESET_MESSAGE };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await prisma.passwordResetToken.count({
    where: {
      userId: user.id,
      createdAt: { gte: oneHourAgo },
    },
  });

  if (recentCount >= 3) {
    return { message: GENERIC_RESET_MESSAGE };
  }

  const jti = generateJti();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: {
      jti,
      userId: user.id,
      expiresAt,
    },
  });

  const token = await signPasswordResetToken({ jti, userId: user.id });
  const resetLink = `${env.clientPublicUrl}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await emailSender.send({
      to: email,
      subject: 'Reset your CarePaddy password',
      body: `Reset your password using this link (expires in 10 minutes): ${resetLink}`,
    });
  } catch (err) {
    logger.warn({ err, email }, 'password reset email dispatch failed');
  }

  return { message: GENERIC_RESET_MESSAGE };
}

export async function confirmPasswordReset(
  input: ResetPasswordConfirmInput,
): Promise<{ message: string }> {
  await assertPasswordPolicy(input.newPassword);

  let payload: { jti: string; userId: string };
  try {
    payload = await verifyPasswordResetToken(input.token);
  } catch {
    throw new AppError(410, 'Invalid or expired reset token', 'RESET_TOKEN_INVALID');
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { jti: payload.jti },
  });

  if (!record || record.userId !== payload.userId) {
    throw new AppError(410, 'Invalid or expired reset token', 'RESET_TOKEN_INVALID');
  }
  if (record.used) {
    throw new AppError(410, 'Invalid or expired reset token', 'RESET_TOKEN_INVALID');
  }
  if (record.expiresAt <= new Date()) {
    throw new AppError(410, 'Invalid or expired reset token', 'RESET_TOKEN_INVALID');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { password: passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { used: true },
    }),
    prisma.session.updateMany({
      where: { userId: record.userId, revoked: false },
      data: { revoked: true },
    }),
  ]);

  return { message: 'Password has been reset. Please sign in again.' };
}
