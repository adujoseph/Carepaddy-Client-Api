import { prisma } from '@lib/prisma';
import { normalizeEmail } from '@lib/normalize';

/** Email must be free on both AdminUser and client User (atomic check in transaction). */
export async function assertEmailAvailableForAdmin(
  email: string,
  tx: Pick<typeof prisma, 'adminUser' | 'user'> = prisma,
) {
  const normalized = normalizeEmail(email);
  const [admin, client] = await Promise.all([
    tx.adminUser.findUnique({ where: { emailLower: normalized } }),
    tx.user.findUnique({ where: { email: normalized } }),
  ]);
  if (admin || client) {
    return false;
  }
  return true;
}
