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
  'carehome:read',
  'carehome:write',
  'carehome:activity',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const SUPER_ADMIN_ROLE_NAME = 'SUPER_ADMIN';

export function isKnownPermission(key: string): key is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(key);
}

/** Permissions that are meaningless without another (e.g. editing care homes you cannot list). */
const IMPLIED_PERMISSIONS: Partial<Record<AdminPermission, AdminPermission[]>> = {
  'carehome:write': ['carehome:read'],
  'carehome:activity': ['carehome:read'],
};

export function assertKnownPermissions(keys: string[]): { valid: AdminPermission[]; invalid: string[] } {
  const invalid = keys.filter((k) => !isKnownPermission(k));
  const valid = new Set(keys.filter(isKnownPermission));
  for (const key of [...valid]) {
    for (const implied of IMPLIED_PERMISSIONS[key] ?? []) valid.add(implied);
  }
  return { valid: [...valid], invalid };
}
