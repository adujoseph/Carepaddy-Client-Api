import { z } from '@docs/zod-extend';
import * as jose from 'jose';
import { env } from '@config/env';
import { prisma } from '@lib/prisma';
import { generateJti, enforceRateLimit } from '@lib/rateLimiter';
import { signInviteToken, verifyInviteToken } from '@lib/jwt';
import { assertPasswordPolicy, hashPassword } from '@lib/password';
import { normalizeEmail, normalizePhone } from '@lib/normalize';
import { requireVerifiedContact } from '@lib/verification';
import { AppError } from '@middleware/error-handler';
import { emailSender, smsSender } from '../../../providers/notify.js';
import { createSessionForUser } from '../session/session.service.js';
import { logger } from '@lib/logger';

/**
 * Invite a guardian for an already-registered resident.
 * Carehomes must create the resident first via POST /residents.
 */
export const createInvitationSchema = z
  .object({
    residentId: z.uuid(),
    guardianName: z.string().trim().min(1).max(200),
    guardianEmail: z.email().optional(),
    guardianPhone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be E.164-ish')
      .optional(),
  })
  .refine((v) => Boolean(v.guardianEmail || v.guardianPhone), {
    message: 'Either guardianEmail or guardianPhone is required',
  });

export const verifyInvitationQuerySchema = z.object({
  token: z.string().min(1),
});

export const completeInvitationSchema = z.object({
  inviteToken: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be E.164-ish'),
  password: z.string().min(12).max(200),
  residentId: z.uuid(),
  tenantId: z.uuid(),
  userType: z.literal('client'),
  userRole: z.literal('guardian'),
  termsAccepted: z.literal(true),
  /** From POST /verifyOTP — required backend gate before registration. */
  verificationToken: z.string().min(1),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type CompleteInvitationInput = z.infer<typeof completeInvitationSchema>;

export async function createInvitation(
  input: CreateInvitationInput,
  auth: { userId: string; tenantId: string | null | undefined; userRole: string },
) {
  if (!auth.tenantId || (auth.userRole !== 'care_admin' && auth.userRole !== 'care_staff')) {
    throw new AppError(403, 'You do not have permission to perform this action', 'FORBIDDEN');
  }

  const email = input.guardianEmail ? normalizeEmail(input.guardianEmail) : null;
  const phone = input.guardianPhone ? normalizePhone(input.guardianPhone) : null;
  const contactKey = email ? `email:${email}` : `phone:${phone}`;

  await enforceRateLimit({
    key: `invite:${input.residentId}:${contactKey}`,
    limit: 3,
    windowSeconds: 24 * 60 * 60,
    message: 'Too many invitation requests. Please try again later.',
    code: 'RATE_LIMITED',
  });

  const resident = await prisma.resident.findFirst({
    where: { id: input.residentId, tenantId: auth.tenantId },
    include: { carehome: true },
  });

  if (!resident) {
    throw new AppError(403, 'Resident not found for this carehome', 'FORBIDDEN');
  }

  const jti = generateJti();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  const existing = await prisma.invite.findFirst({
    where: {
      residentId: resident.id,
      used: false,
      expiresAt: { gt: new Date() },
      ...(email ? { email } : {}),
      ...(phone && !email ? { phone } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  const invite = existing
    ? await prisma.invite.update({
        where: { id: existing.id },
        data: {
          jti,
          guardianName: input.guardianName.trim(),
          email,
          phone,
          expiresAt,
          resendCount: { increment: 1 },
        },
      })
    : await prisma.invite.create({
        data: {
          jti,
          tenantId: auth.tenantId,
          residentId: resident.id,
          guardianName: input.guardianName.trim(),
          email,
          phone,
          expiresAt,
        },
      });

  const token = await signInviteToken({
    jti: invite.jti,
    tenantId: auth.tenantId,
    residentId: resident.id,
    guardianName: invite.guardianName,
    email: invite.email,
    phone: invite.phone,
  });

  const link = `${env.clientPublicUrl}/complete-invitation?token=${encodeURIComponent(token)}`;
  const message = `You've been invited as a guardian for ${resident.name} at ${resident.carehome.name}. Complete registration: ${link}`;

  try {
    if (email) {
      await emailSender.send({
        to: email,
        subject: `Guardian invitation for ${resident.name}`,
        body: message,
      });
    }
    if (phone) {
      await smsSender.send({ to: phone, body: message });
    }
  } catch (err) {
    logger.warn({ err, inviteId: invite.id }, 'invitation dispatch failed');
  }

  return {
    id: invite.id,
    residentId: invite.residentId,
    tenantId: invite.tenantId,
    guardianName: invite.guardianName,
    email: invite.email,
    phone: invite.phone,
    expiresAt: invite.expiresAt,
    resendCount: invite.resendCount,
  };
}

export async function verifyInvitation(token: string) {
  let payload: Awaited<ReturnType<typeof verifyInviteToken>>;
  try {
    payload = await verifyInviteToken(token);
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new AppError(
        410,
        'This invitation has expired. Please ask the carehome to resend it.',
        'INVITE_EXPIRED',
      );
    }
    throw new AppError(400, 'Invalid invitation token', 'INVALID_INVITE');
  }

  const invite = await prisma.invite.findUnique({
    where: { jti: payload.jti },
    include: { resident: true },
  });

  if (!invite) {
    throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
  }
  if (invite.used) {
    throw new AppError(409, 'This invitation has already been used.', 'INVITE_USED');
  }
  if (invite.expiresAt <= new Date()) {
    throw new AppError(
      410,
      'This invitation has expired. Please ask the carehome to resend it.',
      'INVITE_EXPIRED',
    );
  }

  return {
    guardianName: invite.guardianName,
    email: invite.email,
    phone: invite.phone,
    residentName: invite.resident.name,
    tenantId: invite.tenantId,
    residentId: invite.residentId,
  };
}

export async function completeInvitation(
  input: CompleteInvitationInput,
  meta: { userAgent?: string; ip?: string },
) {
  let payload: Awaited<ReturnType<typeof verifyInviteToken>>;
  try {
    payload = await verifyInviteToken(input.inviteToken);
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new AppError(
        410,
        'This invitation has expired. Please ask the carehome to resend it.',
        'INVITE_EXPIRED',
      );
    }
    throw new AppError(400, 'Invalid invitation token', 'INVALID_INVITE');
  }

  if (payload.residentId !== input.residentId || payload.tenantId !== input.tenantId) {
    throw new AppError(400, 'Invitation details do not match', 'INVITE_MISMATCH');
  }

  const invite = await prisma.invite.findUnique({ where: { jti: payload.jti } });
  if (!invite) {
    throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
  }
  if (invite.used) {
    throw new AppError(409, 'This invitation has already been used.', 'INVITE_USED');
  }
  if (invite.expiresAt <= new Date()) {
    throw new AppError(
      410,
      'This invitation has expired. Please ask the carehome to resend it.',
      'INVITE_EXPIRED',
    );
  }

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

  if (invite.email && normalizeEmail(invite.email) !== email) {
    throw new AppError(400, 'Email does not match this invitation', 'EMAIL_MISMATCH');
  }
  if (!invite.email && invite.phone && normalizePhone(invite.phone) !== phone) {
    throw new AppError(400, 'Phone does not match this invitation', 'PHONE_MISMATCH');
  }

  const verified = await requireVerifiedContact({
    verificationToken: input.verificationToken,
    email,
    phone,
  });

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (!existingUser) {
    await assertPasswordPolicy(input.password);
  }

  const user = await prisma.$transaction(async (tx) => {
    let guardian = existingUser;

    if (!guardian) {
      const phoneTaken = await tx.user.findUnique({ where: { phone } });
      if (phoneTaken) {
        throw new AppError(409, 'An account with this phone already exists', 'CONFLICT');
      }

      guardian = await tx.user.create({
        data: {
          name: input.name.trim(),
          email,
          phone,
          password: await hashPassword(input.password),
          userType: 'client',
          userRole: 'guardian',
          status: 'active',
          termsAcceptedAt: new Date(),
          isEmailVerified: verified.isEmailVerified,
          isPhoneVerified: verified.isPhoneVerified,
        },
      });
    } else {
      guardian = await tx.user.update({
        where: { id: guardian.id },
        data: {
          isEmailVerified: guardian.isEmailVerified || verified.isEmailVerified,
          isPhoneVerified: guardian.isPhoneVerified || verified.isPhoneVerified,
          status: guardian.status === 'pending' ? 'active' : guardian.status,
        },
      });
    }

    const existingLink = await tx.guardianResident.findUnique({
      where: {
        guardianId_residentId: {
          guardianId: guardian.id,
          residentId: input.residentId,
        },
      },
    });

    if (existingLink) {
      throw new AppError(409, 'Guardian is already linked to this resident', 'CONFLICT');
    }

    await tx.guardianResident.create({
      data: {
        guardianId: guardian.id,
        residentId: input.residentId,
        tenantId: input.tenantId,
        status: 'active',
      },
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: { used: true, usedAt: new Date() },
    });

    return guardian;
  });

  const tokens = await createSessionForUser({
    userId: user.id,
    userRole: 'guardian',
    tenantId: null,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  const links = await prisma.guardianResident.findMany({
    where: { guardianId: user.id },
    include: { resident: true, carehome: true },
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userType: user.userType,
      userRole: user.userRole,
      status: user.status,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
    },
    residentLinks: links.map((link) => ({
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
