import { z } from '@docs/zod-extend';

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string()).min(1),
});

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: 'At least one of name or description is required',
  });

export const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string()).min(1),
});

export const listRolesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;
export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;
