import { prisma } from '@lib/prisma';
import { assertPasswordPolicy, hashPassword } from '@lib/password';
import { normalizeEmail, normalizePhone } from '@lib/normalize';
import { AppError } from '@middleware/error-handler';
import { runCqcCheckInBackground } from '../../../providers/cqc.provider.js';
import type { RegisterCarehomeInput } from './register.schema.js';

export async function registerCarehome(input: RegisterCarehomeInput) {
  await assertPasswordPolicy(input.password);

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const cqcNumber = input.cqcNumber.trim().toUpperCase();

  const existing = await prisma.carehome.findFirst({
    where: {
      OR: [{ email }, { cqcNumber }, { phone }],
    },
  });
  if (existing) {
    throw new AppError(409, 'A carehome with this email, phone, or CQC number already exists', 'CONFLICT');
  }

  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
  });
  if (existingUser) {
    throw new AppError(409, 'A carehome with this email, phone, or CQC number already exists', 'CONFLICT');
  }

  const passwordHash = await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const carehome = await tx.carehome.create({
      data: {
        name: input.name.trim(),
        cqcNumber,
        email,
        phone,
        addressLine: input.address.fullAddress.trim(),
        city: input.address.city.trim(),
        postcode: input.address.postcode.trim().toUpperCase().replace(/\s+/g, ' '),
        status: 'active',
      },
    });

    const user = await tx.user.create({
      data: {
        name: input.name.trim(),
        email,
        phone,
        password: passwordHash,
        userType: 'client',
        userRole: 'care_admin',
        status: 'active',
        tenantId: carehome.id,
        termsAcceptedAt: new Date(),
      },
    });

    return { carehome, user };
  });

  runCqcCheckInBackground(
    result.carehome.id,
    {
      cqcNumber,
      name: result.carehome.name,
      postcode: result.carehome.postcode,
    },
    async (cqcResult) => {
      await prisma.carehome.update({
        where: { id: result.carehome.id },
        data: {
          cqcCheck: cqcResult.valid,
          cqcCheckedAt: new Date(),
        },
      });
    },
  );

  return {
    carehome: {
      id: result.carehome.id,
      name: result.carehome.name,
      cqcNumber: result.carehome.cqcNumber,
      email: result.carehome.email,
      phone: result.carehome.phone,
      addressLine: result.carehome.addressLine,
      city: result.carehome.city,
      postcode: result.carehome.postcode,
      status: result.carehome.status,
      cqcCheck: result.carehome.cqcCheck,
      isEmailVerified: result.carehome.isEmailVerified,
      isPhoneVerified: result.carehome.isPhoneVerified,
      createdAt: result.carehome.createdAt,
    },
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      phone: result.user.phone,
      userType: result.user.userType,
      userRole: result.user.userRole,
      status: result.user.status,
      tenantId: result.user.tenantId,
      createdAt: result.user.createdAt,
    },
  };
}
