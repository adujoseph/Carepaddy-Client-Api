import { z } from '@docs/zod-extend';
import { prisma } from '@lib/prisma';
import { assertPasswordPolicy, hashPassword } from '@lib/password';
import { normalizeEmail, normalizePhone } from '@lib/normalize';
import { AppError } from '@middleware/error-handler';
import { createSessionForUser } from '../session/session.service.js';
import { emailSender } from '../../../providers/notify.js';
import { logger } from '@lib/logger';

export const selfRegisterSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be E.164-ish'),
  password: z.string().min(12).max(200),
  tenantId: z.uuid(),
  residentName: z.string().trim().min(1).max(200),
  residentNumber: z.string().trim().min(1).max(100),
  termsAccepted: z.literal(true),
});

export type SelfRegisterInput = z.infer<typeof selfRegisterSchema>;

export async function selfRegisterGuardian(
  input: SelfRegisterInput,
  meta: { userAgent?: string; ip?: string },
) {
  await assertPasswordPolicy(input.password);

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const residentNumber = input.residentNumber.trim();
  const residentName = input.residentName.trim().toLowerCase();

  const resident = await prisma.resident.findFirst({
    where: {
      tenantId: input.tenantId,
      residentNumber,
    },
    include: {
      carehome: {
        include: {
          users: {
            where: { userRole: 'care_admin', status: 'active' },
            take: 5,
          },
        },
      },
    },
  });

  if (!resident || resident.name.trim().toLowerCase() !== residentName) {
    throw new AppError(
      404,
      "We couldn't find a resident matching those details — please check with the carehome.",
      'RESIDENT_NOT_FOUND',
    );
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });

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
        },
      });
    }

    const existingLink = await tx.guardianResident.findUnique({
      where: {
        guardianId_residentId: {
          guardianId: guardian.id,
          residentId: resident.id,
        },
      },
    });

    if (existingLink) {
      throw new AppError(409, 'Guardian is already linked to this resident', 'CONFLICT');
    }

    await tx.guardianResident.create({
      data: {
        guardianId: guardian.id,
        residentId: resident.id,
        tenantId: input.tenantId,
        status: 'pending',
      },
    });

    return guardian;
  });

  try {
    for (const admin of resident.carehome.users) {
      if (!admin.email) continue;
      await emailSender.send({
        to: admin.email,
        subject: 'New guardian claim awaiting approval',
        body: `${input.name.trim()} has requested guardian access for ${resident.name} (${resident.residentNumber}) and is awaiting approval.`,
      });
    }
  } catch (err) {
    logger.warn({ err, residentId: resident.id }, 'guardian claim notification failed');
  }

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
    pendingApproval: true,
  };
}
