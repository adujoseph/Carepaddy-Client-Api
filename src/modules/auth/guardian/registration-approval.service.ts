import { z } from '@docs/zod-extend';
import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import { logger } from '@lib/logger';
import { emailSender } from '../../../providers/notify.js';

export const listGuardianRegistrationsQuerySchema = z.object({
  status: z.enum(['pending', 'active', 'rejected']).optional().default('pending'),
});

export const reviewGuardianRegistrationSchema = z
  .object({
    isApproved: z.boolean(),
    reason: z.string().trim().min(1).max(1000).optional(),
    /** Required when approving — resident to attach the guardian to. */
    residentId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.isApproved && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A reason is required when rejecting a registration',
      });
    }
    if (value.isApproved && !value.residentId) {
      ctx.addIssue({
        code: 'custom',
        path: ['residentId'],
        message: 'residentId is required when approving a registration',
      });
    }
  });

export type ListGuardianRegistrationsQuery = z.infer<typeof listGuardianRegistrationsQuerySchema>;
export type ReviewGuardianRegistrationInput = z.infer<typeof reviewGuardianRegistrationSchema>;

type CarehomeAuth = {
  userId: string;
  tenantId: string | null | undefined;
  userRole: string;
};

function assertCarehomeStaff(auth: Pick<CarehomeAuth, 'tenantId' | 'userRole'>) {
  if (!auth.tenantId || (auth.userRole !== 'care_admin' && auth.userRole !== 'care_staff')) {
    throw new AppError(403, 'You do not have permission to perform this action', 'FORBIDDEN');
  }
  return auth.tenantId;
}

function serializeGuardian(guardian: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
}) {
  return {
    id: guardian.id,
    name: guardian.name,
    email: guardian.email,
    phone: guardian.phone,
    status: guardian.status,
  };
}

async function loadPendingRequest(requestId: string, tenantId: string) {
  const request = await prisma.guardianRegistrationRequest.findFirst({
    where: { id: requestId, tenantId },
    include: {
      guardian: true,
      carehome: { select: { id: true, name: true } },
    },
  });

  if (!request) {
    throw new AppError(404, 'Guardian registration request not found', 'NOT_FOUND');
  }
  if (request.status !== 'pending') {
    throw new AppError(409, 'This registration request has already been reviewed', 'ALREADY_REVIEWED');
  }

  return request;
}

export async function listGuardianRegistrations(
  query: ListGuardianRegistrationsQuery,
  auth: Pick<CarehomeAuth, 'tenantId' | 'userRole'>,
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
      rejectionReason: row.rejectionReason,
      registeredAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      guardian: row.guardian,
      resident: row.resident,
    })),
  };
}

async function approveRequest(
  request: Awaited<ReturnType<typeof loadPendingRequest>>,
  residentId: string,
  auth: CarehomeAuth,
  tenantId: string,
) {
  const resident = await prisma.resident.findFirst({
    where: { id: residentId, tenantId },
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
        rejectionReason: null,
        reviewedAt: new Date(),
        reviewedById: auth.userId,
      },
    });

    return { link, guardian, updatedRequest };
  });

  if (result.guardian.email) {
    try {
      await emailSender.send({
        to: result.guardian.email,
        subject: `Guardian access approved — ${request.carehome.name}`,
        body: [
          `Hi ${result.guardian.name},`,
          ``,
          `Your guardian registration has been approved.`,
          ``,
          `Care home: ${request.carehome.name}`,
          `Resident: ${resident.name}`,
          `Resident number: ${resident.residentNumber}`,
          ``,
          `You can now sign in to CarePaddy and access updates for this resident.`,
          ``,
          `— CarePaddy`,
        ].join('\n'),
      });
    } catch (err) {
      logger.warn(
        { err, requestId: request.id, guardianId: result.guardian.id },
        'guardian approval notification email failed',
      );
    }
  }

  return {
    id: result.updatedRequest.id,
    status: result.updatedRequest.status,
    isApproved: true as const,
    reviewedAt: result.updatedRequest.reviewedAt,
    guardian: serializeGuardian(result.guardian),
    resident: {
      id: resident.id,
      name: resident.name,
      residentNumber: resident.residentNumber,
    },
    carehome: request.carehome,
    link: {
      id: result.link.id,
      status: result.link.status,
    },
  };
}

async function rejectRequest(
  request: Awaited<ReturnType<typeof loadPendingRequest>>,
  reason: string,
  auth: CarehomeAuth,
) {
  const result = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.guardianRegistrationRequest.update({
      where: { id: request.id },
      data: {
        status: 'rejected',
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedById: auth.userId,
      },
    });

    const guardian = await tx.user.update({
      where: { id: request.guardianId },
      data: { status: 'rejected' },
    });

    return { updatedRequest, guardian };
  });

  return {
    id: result.updatedRequest.id,
    status: result.updatedRequest.status,
    isApproved: false as const,
    rejectionReason: result.updatedRequest.rejectionReason,
    reviewedAt: result.updatedRequest.reviewedAt,
    guardian: serializeGuardian(result.guardian),
  };
}

/** Approve or reject a pending guardian self-registration. */
export async function reviewGuardianRegistration(
  requestId: string,
  input: ReviewGuardianRegistrationInput,
  auth: CarehomeAuth,
) {
  const tenantId = assertCarehomeStaff(auth);
  const request = await loadPendingRequest(requestId, tenantId);

  if (input.isApproved) {
    return approveRequest(request, input.residentId!, auth, tenantId);
  }

  return rejectRequest(request, input.reason!.trim(), auth);
}
