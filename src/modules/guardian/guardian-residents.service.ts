import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';

export async function listGuardianResidents(guardianId: string, userRole: string) {
  if (userRole !== 'guardian') {
    throw new AppError(403, 'Only guardians can access resident links', 'FORBIDDEN');
  }

  const links = await prisma.guardianResident.findMany({
    where: { guardianId },
    orderBy: { createdAt: 'desc' },
    include: {
      resident: {
        select: {
          id: true,
          name: true,
          residentNumber: true,
        },
      },
      carehome: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return {
    data: links.map((link) => ({
      linkId: link.id,
      residentId: link.residentId,
      residentName: link.resident.name,
      carehomeId: link.carehome.id,
      carehomeName: link.carehome.name,
      roomNumber: link.resident.residentNumber,
      status: link.status,
      linkedAt: link.createdAt,
    })),
  };
}
