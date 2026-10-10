import { z } from '@docs/zod-extend';

export const listClientProductsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const createStoreOrderSchema = z.object({
  residentId: z.uuid(),
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.coerce.number().int().min(1).max(999),
      }),
    )
    .min(1),
  deliveryAddressLine: z.string().trim().min(1).max(300),
  deliveryCity: z.string().trim().min(1).max(100),
  deliveryPostcode: z.string().trim().min(1).max(20),
});

export const listClientOrdersQuerySchema = z.object({
  status: z
    .enum(['all', 'new', 'declined', 'pending_delivery', 'in_progress', 'delivered'])
    .optional()
    .default('all'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const guardianOrderDecisionSchema = z
  .object({
    approved: z.boolean(),
    declineReason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.approved || Boolean(v.declineReason?.trim()), {
    message: 'declineReason is required when declining an order',
  });

export type ListClientProductsQuery = z.infer<typeof listClientProductsQuerySchema>;
export type CreateStoreOrderInput = z.infer<typeof createStoreOrderSchema>;
export type ListClientOrdersQuery = z.infer<typeof listClientOrdersQuerySchema>;
export type GuardianOrderDecisionInput = z.infer<typeof guardianOrderDecisionSchema>;
