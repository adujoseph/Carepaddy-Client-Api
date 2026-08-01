import { z } from '@docs/zod-extend';
import { prisma } from '@lib/prisma';
import { assertPasswordPolicy, hashPassword } from '@lib/password';
import { normalizeEmail, normalizePhone } from '@lib/normalize';
import { requireVerifiedContact } from '@lib/verification';
import { AppError } from '@middleware/error-handler';
import { createSessionForUser } from '../session/session.service.js';
import { emailSender } from '../../../providers/notify.js';
import { logger } from '@lib/logger';

/**
 * Guardian self-registration without an invite.
 * Requires prior OTP verification. Resident number is optional (hint only).
 * Account stays pending until a carehome approves and attaches a resident.
 */
export const selfRegisterSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be E.164-ish'),
  password: z.string().min(12).max(200),
  tenantId: z.uuid(),
  residentName: z.string().trim().min(1).max(200).optional(),
  residentNumber: z.string().trim().min(1).max(100).optional(),
  termsAccepted: z.literal(true),
  /** From POST /verifyOTP — required backend gate before registration. */
  verificationToken: z.string().min(1),
});

export type SelfRegisterInput = z.infer<typeof selfRegisterSchema>;

export async function selfRegisterGuardian(
  input: SelfRegisterInput,
  meta: { userAgent?: string; ip?: string },
) {
  await assertPasswordPolicy(input.password);

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

  const verified = await requireVerifiedContact({
    verificationToken: input.verificationToken,
    email,
    phone,
  });

  const carehome = await prisma.carehome.findUnique({
    where: { id: input.tenantId },
    include: {
      users: {
        where: { userRole: 'care_admin', status: 'active' },
        take: 5,
      },
    },
  });

  if (!carehome || carehome.status !== 'active') {
    throw new AppError(404, 'Carehome not found', 'CAREHOME_NOT_FOUND');
  }

  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) {
    throw new AppError(409, 'An account with this email already exists', 'CONFLICT');
  }

  const existingPhone = await prisma.user.findUnique({ where: { phone } });
  if (existingPhone) {
    throw new AppError(409, 'An account with this phone already exists', 'CONFLICT');
  }

  const residentNameHint = input.residentName?.trim() || null;
  const residentNumberHint = input.residentNumber?.trim() || null;

  const user = await prisma.$transaction(async (tx) => {
    const guardian = await tx.user.create({
      data: {
        name: input.name.trim(),
        email,
        phone,
        password: await hashPassword(input.password),
        userType: 'client',
        userRole: 'guardian',
        status: 'pending',
        termsAcceptedAt: new Date(),
        isEmailVerified: verified.isEmailVerified,
        isPhoneVerified: verified.isPhoneVerified,
      },
    });

    await tx.guardianRegistrationRequest.create({
      data: {
        guardianId: guardian.id,
        tenantId: carehome.id,
        residentNameHint,
        residentNumberHint,
        status: 'pending',
      },
    });

    return guardian;
  });

  try {
    for (const admin of carehome.users) {
      if (!admin.email) continue;
      const hint = [residentNameHint, residentNumberHint].filter(Boolean).join(' / ') || 'unspecified';
      await emailSender.send({
        to: admin.email,
        subject: 'New guardian registration awaiting approval',
        body: `${input.name.trim()} has registered as a guardian for ${carehome.name} (resident hint: ${hint}) and is awaiting approval.`,
      });
    }
  } catch (err) {
    logger.warn({ err, tenantId: carehome.id }, 'guardian registration notification failed');
  }

  const tokens = await createSessionForUser({
    userId: user.id,
    userRole: 'guardian',
    tenantId: null,
    userAgent: meta.userAgent,
    ip: meta.ip,
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
    residentLinks: [],
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    pendingApproval: true,
  };
}
