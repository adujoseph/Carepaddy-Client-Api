import { z } from '@docs/zod-extend';
import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';

export const listGuardianRegistrationsQuerySchema = z.object({
  status: z.enum(['pending', 'active', 'rejected']).optional().default('pending'),
});

export const approveGuardianRegistrationSchema = z.object({
  residentId: z.uuid(),
});

export type ListGuardianRegistrationsQuery = z.infer<typeof listGuardianRegistrationsQuerySchema>;
export type ApproveGuardianRegistrationInput = z.infer<typeof approveGuardianRegistrationSchema>;

function assertCarehomeStaff(auth: {
  tenantId: string | null | undefined;
  userRole: string;
}) {
  if (!auth.tenantId || (auth.userRole !== 'care_admin' && auth.userRole !== 'care_staff')) {
    throw new AppError(403, 'You do not have permission to perform this action', 'FORBIDDEN');
  }
  return auth.tenantId;
}

export async function listGuardianRegistrations(
  query: ListGuardianRegistrationsQuery,
  auth: { tenantId: string | null | undefined; userRole: string },
) {
  const tenantId = assertCarehomeStaff(auth);

  const rows = await prisma.guardianRegistrationRequest.findMany({
    where: {
      tenantId,
      status: query.status,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      guardian: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          isEmailVerified: true,
          isPhoneVerified: true,
          createdAt: true,
        },
      },
      resident: {
        select: {
          id: true,
          name: true,
          residentNumber: true,
        },
      },
    },
  });

  return {
    data: rows.map((row) => ({
      id: row.id,
      status: row.status,
      residentNameHint: row.residentNameHint,
      residentNumberHint: row.residentNumberHint,
      registeredAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      guardian: row.guardian,
      resident: row.resident,
    })),
  };
}

export async function approveGuardianRegistration(
  requestId: string,
  input: ApproveGuardianRegistrationInput,
  auth: { userId: string; tenantId: string | null | undefined; userRole: string },
) {
  const tenantId = assertCarehomeStaff(auth);

  const request = await prisma.guardianRegistrationRequest.findFirst({
    where: { id: requestId, tenantId },
    include: { guardian: true },
  });

  if (!request) {
    throw new AppError(404, 'Guardian registration request not found', 'NOT_FOUND');
  }

  if (request.status !== 'pending') {
    throw new AppError(409, 'This registration request has already been reviewed', 'ALREADY_REVIEWED');
  }

  const resident = await prisma.resident.findFirst({
    where: { id: input.residentId, tenantId },
  });

  if (!resident) {
    throw new AppError(404, 'Resident not found for this carehome', 'RESIDENT_NOT_FOUND');
  }

  const result = await prisma.$transaction(async (tx) => {
    const existingLink = await tx.guardianResident.findUnique({
      where: {
        guardianId_residentId: {
          guardianId: request.guardianId,
          residentId: resident.id,
        },
      },
    });

    if (existingLink) {
      throw new AppError(409, 'Guardian is already linked to this resident', 'CONFLICT');
    }

    const link = await tx.guardianResident.create({
      data: {
        guardianId: request.guardianId,
        residentId: resident.id,
        tenantId,
        status: 'active',
      },
    });

    const guardian = await tx.user.update({
      where: { id: request.guardianId },
      data: { status: 'active' },
    });

    const updatedRequest = await tx.guardianRegistrationRequest.update({
      where: { id: request.id },
      data: {
        status: 'active',
        residentId: resident.id,
        reviewedAt: new Date(),
        reviewedById: auth.userId,
      },
    });

    return { link, guardian, updatedRequest };
  });

  return {
    id: result.updatedRequest.id,
    status: result.updatedRequest.status,
    reviewedAt: result.updatedRequest.reviewedAt,
    guardian: {
      id: result.guardian.id,
      name: result.guardian.name,
      email: result.guardian.email,
      phone: result.guardian.phone,
      status: result.guardian.status,
    },
    resident: {
      id: resident.id,
      name: resident.name,
      residentNumber: resident.residentNumber,
    },
    link: {
      id: result.link.id,
      status: result.link.status,
    },
  };
}
