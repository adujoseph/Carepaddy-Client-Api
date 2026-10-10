import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';

export async function assertCarehomeStaffTenant(tenantId: string | null | undefined) {
  if (!tenantId) {
    throw new AppError(403, 'Tenant context required', 'FORBIDDEN');
  }
  return tenantId;
}

export async function assertResidentInCarehome(residentId: string, carehomeId: string) {
  const resident = await prisma.resident.findFirst({
    where: { id: residentId, tenantId: carehomeId },
  });
  if (!resident) {
    throw new AppError(404, 'Resident not found for this care home', 'NOT_FOUND');
  }
  return resident;
}

/** Guardian must have an active link to the order's resident. */
export async function assertGuardianCanAccessOrder(guardianId: string, order: { residentId: string }) {
  const link = await prisma.guardianResident.findFirst({
    where: {
      guardianId,
      residentId: order.residentId,
      status: 'active',
    },
  });
  if (!link) {
    throw new AppError(403, 'You are not authorized to act on this order', 'FORBIDDEN');
  }
  return link;
}

export async function assertCarehomeStaffCanAccessOrder(
  tenantId: string,
  order: { carehomeId: string },
) {
  if (order.carehomeId !== tenantId) {
    throw new AppError(403, 'You are not authorized to view this order', 'FORBIDDEN');
  }
}
