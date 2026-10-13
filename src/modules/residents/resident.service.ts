import { z } from '@docs/zod-extend';
import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import { touchCarehomeActivity } from '@lib/carehome-status';

export const createResidentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  residentNumber: z.string().trim().min(1).max(100),
});

export type CreateResidentInput = z.infer<typeof createResidentSchema>;

export async function createResident(
  input: CreateResidentInput,
  auth: { tenantId: string | null | undefined; userRole: string },
) {
  if (!auth.tenantId || (auth.userRole !== 'care_admin' && auth.userRole !== 'care_staff')) {
    throw new AppError(403, 'You do not have permission to perform this action', 'FORBIDDEN');
  }

  const residentNumber = input.residentNumber.trim();
  const name = input.name.trim();

  const existing = await prisma.resident.findUnique({
    where: {
      tenantId_residentNumber: {
        tenantId: auth.tenantId,
        residentNumber,
      },
    },
  });
  if (existing) {
    throw new AppError(409, 'A resident with this number already exists', 'CONFLICT');
  }

  const resident = await prisma.resident.create({
    data: {
      tenantId: auth.tenantId,
      name,
      residentNumber,
    },
  });

  void touchCarehomeActivity(auth.tenantId);

  return {
    id: resident.id,
    name: resident.name,
    residentNumber: resident.residentNumber,
    tenantId: resident.tenantId,
  };
}

export async function listResidents(auth: {
  tenantId: string | null | undefined;
  userRole: string;
}) {
  if (!auth.tenantId || (auth.userRole !== 'care_admin' && auth.userRole !== 'care_staff')) {
    throw new AppError(403, 'You do not have permission to perform this action', 'FORBIDDEN');
  }

  const rows = await prisma.resident.findMany({
    where: { tenantId: auth.tenantId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      residentNumber: true,
      tenantId: true,
    },
  });

  return { data: rows };
}
