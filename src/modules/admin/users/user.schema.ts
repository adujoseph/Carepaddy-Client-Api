import { z } from '@docs/zod-extend';

export const createAdminUserSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(200),
  roleId: z.uuid(),
});

export const listAdminUsersQuerySchema = z.object({
  status: z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED', 'all']).optional().default('all'),
  roleId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const reassignRoleSchema = z.object({
  roleId: z.uuid(),
});

export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;
export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;
export type ReassignRoleInput = z.infer<typeof reassignRoleSchema>;
