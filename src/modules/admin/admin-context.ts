import { env } from '@config/env';
import { prisma } from '@lib/prisma';
import {
  ADMIN_PERMISSIONS,
  SUPER_ADMIN_ROLE_NAME,
  type AdminPermission,
} from './permissions.js';

export type AdminContext = {
  id: string;
  email: string;
  name: string;
  status: string;
  mustChangePassword: boolean;
  mfaEnrolled: boolean;
  mfaRecoveryRegenRequired: boolean;
  role: {
    id: string;
    name: string;
    isSystem: boolean;
  };
  permissions: AdminPermission[];
};

export async function loadAdminContext(adminUserId: string): Promise<AdminContext | null> {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminUserId },
    include: {
      role: {
        include: { permissions: true },
      },
    },
  });
  if (!admin) return null;

  const permissions =
    admin.role.name.toUpperCase() === SUPER_ADMIN_ROLE_NAME
      ? [...ADMIN_PERMISSIONS]
      : admin.role.permissions.map((p) => p.permissionKey as AdminPermission);

  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    status: admin.status,
    mustChangePassword: admin.mustChangePassword,
    mfaEnrolled: Boolean(admin.mfaEnrolledAt),
    mfaRecoveryRegenRequired: admin.mfaRecoveryRegenRequired,
    role: {
      id: admin.role.id,
      name: admin.role.name,
      isSystem: admin.role.isSystem,
    },
    permissions,
  };
}

export function serializeAdminMe(ctx: AdminContext) {
  return {
    id: ctx.id,
    email: ctx.email,
    name: ctx.name,
    status: ctx.status,
    mustChangePassword: ctx.mustChangePassword,
    mfaEnrolled: ctx.mfaEnrolled,
    mfaRecoveryRegenRequired: ctx.mfaRecoveryRegenRequired,
    role: ctx.role,
    permissions: ctx.permissions,
  };
}

export function superAdminRequiresMfa(ctx: AdminContext): boolean {
  if (!env.adminRequireSuperAdminMfa) return false;
  return ctx.role.name.toUpperCase() === SUPER_ADMIN_ROLE_NAME && !ctx.mfaEnrolled;
}
