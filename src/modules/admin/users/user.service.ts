import { randomUUID } from 'node:crypto';
import { env } from '@config/env';
import { prisma } from '@lib/prisma';
import { signAdminInviteToken } from '@lib/admin-jwt';
import { normalizeEmail } from '@lib/normalize';
import { hashPassword } from '@lib/password';
import { generateJti } from '@lib/rateLimiter';
import { AppError } from '@middleware/error-handler';
import { emailSender } from '../../../providers/notify.js';
import { logger } from '@lib/logger';
import { writeAdminAuditLog } from '../audit.service.js';
import { assertEmailAvailableForAdmin } from '../email-availability.js';
import { assertNotLastActiveSuperAdmin } from '../guards.js';
import { SUPER_ADMIN_ROLE_NAME } from '../permissions.js';
import type { CreateAdminUserInput, ListAdminUsersQuery, ReassignRoleInput } from './user.schema.js';

function serializeAdmin(user: {
  id: string;
  email: string;
  name: string;
  status: string;
  mustChangePassword: boolean;
  createdAt: Date;
  role: { id: string; name: string };
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    role: user.role,
    dateAdded: user.createdAt,
  };
}

async function loadAdminOrThrow(id: string) {
  const admin = await prisma.adminUser.findUnique({
    where: { id },
    include: { role: true },
  });
  if (!admin) {
    throw new AppError(404, 'Admin not found', 'NOT_FOUND');
  }
  return admin;
}

async function issueInvite(adminUserId: string, email: string) {
  await prisma.adminInviteToken.updateMany({
    where: { adminUserId, used: false },
    data: { used: true, usedAt: new Date() },
  });

  const jti = generateJti();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await prisma.adminInviteToken.create({
    data: { jti, adminUserId, expiresAt },
  });

  const token = await signAdminInviteToken({ jti, adminUserId, email });
  const link = `${env.adminPublicUrl}/admin/accept-invite?token=${encodeURIComponent(token)}`;

  try {
    await emailSender.send({
      to: email,
      subject: 'Set up your CarePaddy admin account',
      body: `You've been invited to CarePaddy admin. Set your password: ${link}`,
    });
  } catch (err) {
    logger.warn({ err, adminUserId }, 'admin invite email failed');
  }
}

export async function listAdminUsers(query: ListAdminUsersQuery) {
  const skip = (query.page - 1) * query.limit;
  const where = {
    ...(query.status !== 'all' ? { status: query.status } : {}),
    ...(query.roleId ? { roleId: query.roleId } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.adminUser.count({ where }),
    prisma.adminUser.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: { role: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    data: rows.map(serializeAdmin),
  };
}

export async function getAdminUser(id: string) {
  const admin = await loadAdminOrThrow(id);
  return serializeAdmin(admin);
}

export async function createAdminUser(input: CreateAdminUserInput, actorId: string) {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  const role = await prisma.adminRole.findUnique({ where: { id: input.roleId } });
  if (!role) {
    throw new AppError(404, 'Role not found', 'NOT_FOUND');
  }

  const placeholderPassword = await hashPassword(randomUUID());

  const admin = await prisma.$transaction(async (tx) => {
    const available = await assertEmailAvailableForAdmin(email, tx);
    if (!available) {
      throw new AppError(409, 'An account with this email already exists', 'CONFLICT');
    }

    return tx.adminUser.create({
      data: {
        email,
        emailLower: email,
        name,
        password: placeholderPassword,
        status: 'INVITED',
        roleId: input.roleId,
      },
      include: { role: { select: { id: true, name: true } } },
    });
  });

  await issueInvite(admin.id, email);

  await writeAdminAuditLog({
    actorId,
    action: 'admin.create',
    targetType: 'AdminUser',
    targetId: admin.id,
    afterState: serializeAdmin(admin),
  });

  return serializeAdmin(admin);
}

export async function resendAdminInvite(id: string, actorId: string) {
  const admin = await loadAdminOrThrow(id);
  if (admin.status !== 'INVITED') {
    throw new AppError(409, 'Invite can only be resent for INVITED admins', 'INVALID_STATUS');
  }

  await issueInvite(admin.id, admin.email);

  await writeAdminAuditLog({
    actorId,
    action: 'admin.invite.resend',
    targetType: 'AdminUser',
    targetId: id,
  });

  return { message: 'Invitation resent' };
}

export async function deactivateAdminUser(id: string, actorId: string) {
  const admin = await loadAdminOrThrow(id);
  if (admin.status === 'DEACTIVATED') {
    throw new AppError(409, 'Admin is already deactivated', 'ALREADY_DEACTIVATED');
  }

  await assertNotLastActiveSuperAdmin(id);

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id },
      data: { status: 'DEACTIVATED' },
    });
    await tx.adminSession.updateMany({
      where: { adminUserId: id, revoked: false },
      data: { revoked: true },
    });
  });

  await writeAdminAuditLog({
    actorId,
    action: 'admin.deactivate',
    targetType: 'AdminUser',
    targetId: id,
    beforeState: { status: admin.status },
    afterState: { status: 'DEACTIVATED' },
  });

  return serializeAdmin({ ...admin, status: 'DEACTIVATED' });
}

export async function reactivateAdminUser(id: string, actorId: string) {
  const admin = await loadAdminOrThrow(id);
  if (admin.status !== 'DEACTIVATED') {
    throw new AppError(409, 'Admin is not deactivated', 'NOT_DEACTIVATED');
  }

  const updated = await prisma.adminUser.update({
    where: { id },
    data: { status: 'ACTIVE' },
    include: { role: { select: { id: true, name: true } } },
  });

  await writeAdminAuditLog({
    actorId,
    action: 'admin.reactivate',
    targetType: 'AdminUser',
    targetId: id,
    beforeState: { status: admin.status },
    afterState: { status: 'ACTIVE' },
  });

  return serializeAdmin(updated);
}

export async function reassignAdminRole(id: string, input: ReassignRoleInput, actorId: string) {
  const admin = await loadAdminOrThrow(id);
  const newRole = await prisma.adminRole.findUnique({ where: { id: input.roleId } });
  if (!newRole) {
    throw new AppError(404, 'Role not found', 'NOT_FOUND');
  }

  if (
    admin.role.nameLower === SUPER_ADMIN_ROLE_NAME.toLowerCase() &&
    admin.status === 'ACTIVE'
  ) {
    await assertNotLastActiveSuperAdmin(id);
  }

  const updated = await prisma.adminUser.update({
    where: { id },
    data: { roleId: input.roleId },
    include: { role: { select: { id: true, name: true } } },
  });

  await writeAdminAuditLog({
    actorId,
    action: 'admin.role.reassign',
    targetType: 'AdminUser',
    targetId: id,
    beforeState: { roleId: admin.roleId, roleName: admin.role.name },
    afterState: { roleId: updated.roleId, roleName: updated.role.name },
  });

  return serializeAdmin(updated);
}
