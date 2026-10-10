/** Known permission keys for admin RBAC. */
export const ADMIN_PERMISSIONS = [
  'roles:read',
  'roles:write',
  'admins:read',
  'admins:write',
  'audit:read',
  'product:view',
  'product:edit',
  'product:delete',
  'store-order:view',
  'store-order:fulfill',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const SUPER_ADMIN_ROLE_NAME = 'SUPER_ADMIN';

export function isKnownPermission(key: string): key is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(key);
}

export function assertKnownPermissions(keys: string[]): { valid: AdminPermission[]; invalid: string[] } {
  const invalid = keys.filter((k) => !isKnownPermission(k));
  const valid = keys.filter(isKnownPermission);
  return { valid, invalid };
}
