import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import { SUPER_ADMIN_ROLE_NAME } from './permissions.js';

export async function countActiveSuperAdmins(excludeAdminId?: string) {
  return prisma.adminUser.count({
    where: {
      status: 'ACTIVE',
      ...(excludeAdminId ? { NOT: { id: excludeAdminId } } : {}),
      role: { nameLower: SUPER_ADMIN_ROLE_NAME.toLowerCase() },
    },
  });
}

export async function assertNotLastActiveSuperAdmin(adminUserId: string) {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminUserId },
    include: { role: true },
  });
  if (!admin || admin.role.nameLower !== SUPER_ADMIN_ROLE_NAME.toLowerCase()) {
    return;
  }
  if (admin.status !== 'ACTIVE') {
    return;
  }
  const others = await countActiveSuperAdmins(adminUserId);
  if (others === 0) {
    throw new AppError(400, 'Cannot leave zero active super admins', 'LAST_SUPER_ADMIN');
  }
}
