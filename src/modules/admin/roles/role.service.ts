import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import { writeAdminAuditLog } from '../audit.service.js';
import {
  ADMIN_PERMISSIONS,
  SUPER_ADMIN_ROLE_NAME,
  assertKnownPermissions,
} from '../permissions.js';
import type {
  CreateRoleInput,
  ListRolesQuery,
  UpdateRoleInput,
  UpdateRolePermissionsInput,
} from './role.schema.js';

function serializeRole(role: {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permissionKey: string }[];
  _count?: { admins: number };
}) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionCount: role.permissions.length,
    assignedAdminCount: role._count?.admins ?? 0,
    permissions: role.permissions.map((p) => p.permissionKey),
  };
}

async function loadRoleOrThrow(id: string) {
  const role = await prisma.adminRole.findUnique({
    where: { id },
    include: { permissions: true, _count: { select: { admins: true } } },
  });
  if (!role) {
    throw new AppError(404, 'Role not found', 'NOT_FOUND');
  }
  return role;
}

function assertNotSystemRole(role: { isSystem: boolean; name: string }, action: string) {
  if (role.isSystem || role.name.toUpperCase() === SUPER_ADMIN_ROLE_NAME) {
    throw new AppError(403, `System roles cannot be ${action}`, 'SYSTEM_ROLE_PROTECTED');
  }
}

export function listPermissionCatalog() {
  return { permissions: [...ADMIN_PERMISSIONS] };
}

export async function listRoles(query: ListRolesQuery) {
  const skip = (query.page - 1) * query.limit;
  const search = query.search?.trim().toLowerCase();
  const where = search ? { nameLower: { contains: search } } : {};

  const [total, rows] = await Promise.all([
    prisma.adminRole.count({ where }),
    prisma.adminRole.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { name: 'asc' },
      include: {
        permissions: true,
        _count: { select: { admins: true } },
      },
    }),
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    data: rows.map(serializeRole),
  };
}

export async function createRole(input: CreateRoleInput, actorId: string) {
  const name = input.name.trim();
  const nameLower = name.toLowerCase();
  const { valid, invalid } = assertKnownPermissions(input.permissions);
  if (invalid.length > 0) {
    throw new AppError(400, `Unknown permissions: ${invalid.join(', ')}`, 'INVALID_PERMISSIONS');
  }

  const existing = await prisma.adminRole.findUnique({ where: { nameLower } });
  if (existing) {
    throw new AppError(409, `Role name "${name}" already exists`, 'ROLE_NAME_CONFLICT');
  }

  const role = await prisma.adminRole.create({
    data: {
      name,
      nameLower,
      description: input.description?.trim(),
      permissions: {
        create: valid.map((permissionKey) => ({ permissionKey })),
      },
    },
    include: { permissions: true, _count: { select: { admins: true } } },
  });

  await writeAdminAuditLog({
    actorId,
    action: 'role.create',
    targetType: 'AdminRole',
    targetId: role.id,
    afterState: serializeRole(role),
  });

  return serializeRole(role);
}

export async function updateRole(id: string, input: UpdateRoleInput, actorId: string) {
  const before = await loadRoleOrThrow(id);
  assertNotSystemRole(before, 'renamed or updated');

  const data: { name?: string; nameLower?: string; description?: string | null } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    const nameLower = name.toLowerCase();
    if (nameLower !== before.nameLower) {
      const conflict = await prisma.adminRole.findUnique({ where: { nameLower } });
      if (conflict) {
        throw new AppError(409, `Role name "${name}" already exists`, 'ROLE_NAME_CONFLICT');
      }
      data.name = name;
      data.nameLower = nameLower;
    }
  }
  if (input.description !== undefined) {
    data.description = input.description.trim() || null;
  }

  const role = await prisma.adminRole.update({
    where: { id },
    data,
    include: { permissions: true, _count: { select: { admins: true } } },
  });

  await writeAdminAuditLog({
    actorId,
    action: 'role.update',
    targetType: 'AdminRole',
    targetId: id,
    beforeState: serializeRole(before),
    afterState: serializeRole(role),
  });

  return serializeRole(role);
}

export async function updateRolePermissions(
  id: string,
  input: UpdateRolePermissionsInput,
  actorId: string,
) {
  const before = await loadRoleOrThrow(id);
  assertNotSystemRole(before, 'edited');

  const { valid, invalid } = assertKnownPermissions(input.permissions);
  if (invalid.length > 0) {
    throw new AppError(400, `Unknown permissions: ${invalid.join(', ')}`, 'INVALID_PERMISSIONS');
  }

  const role = await prisma.$transaction(async (tx) => {
    await tx.adminRolePermission.deleteMany({ where: { roleId: id } });
    await tx.adminRolePermission.createMany({
      data: valid.map((permissionKey) => ({ roleId: id, permissionKey })),
    });
    return tx.adminRole.findUniqueOrThrow({
      where: { id },
      include: { permissions: true, _count: { select: { admins: true } } },
    });
  });

  await writeAdminAuditLog({
    actorId,
    action: 'role.permissions.update',
    targetType: 'AdminRole',
    targetId: id,
    beforeState: serializeRole(before),
    afterState: serializeRole(role),
  });

  return serializeRole(role);
}

export async function deleteRole(id: string, actorId: string) {
  const role = await loadRoleOrThrow(id);
  assertNotSystemRole(role, 'deleted');

  if (role._count && role._count.admins > 0) {
    throw new AppError(
      409,
      `Cannot delete role: ${role._count.admins} admin(s) still assigned`,
      'ROLE_IN_USE',
    );
  }

  await prisma.adminRole.delete({ where: { id } });

  await writeAdminAuditLog({
    actorId,
    action: 'role.delete',
    targetType: 'AdminRole',
    targetId: id,
    beforeState: serializeRole(role),
  });

  return { message: 'Role deleted' };
}
