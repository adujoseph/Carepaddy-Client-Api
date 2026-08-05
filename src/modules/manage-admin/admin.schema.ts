import { z } from '@docs/zod-extend';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be E.164-ish');

export const inviteAdminSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  phone: phoneSchema,
  /** Defaults to care_staff. Only care_admin may invite. */
  role: z.enum(['care_staff', 'care_admin']).optional().default('care_staff'),
});

export const verifyAdminInviteQuerySchema = z.object({
  token: z.string().min(1),
});

export const acceptAdminInviteSchema = z.object({
  inviteToken: z.string().min(1),
  password: z.string().min(12).max(200),
  termsAccepted: z.literal(true),
});

export const listAdminsQuerySchema = z.object({
  /** UI tabs: active | deactivated | invite_sent | all */
  status: z.enum(['active', 'deactivated', 'invite_sent', 'all']).optional().default('all'),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;
export type AcceptAdminInviteInput = z.infer<typeof acceptAdminInviteSchema>;
export type ListAdminsQuery = z.infer<typeof listAdminsQuerySchema>;
