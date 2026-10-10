import { z } from '@docs/zod-extend';

export const storeOrderStatusFilterSchema = z.enum([
  'all',
  'new',
  'declined',
  'pending_delivery',
  'in_progress',
  'delivered',
]);

export const listStoreOrdersQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: storeOrderStatusFilterSchema.optional().default('all'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ListStoreOrdersQuery = z.infer<typeof listStoreOrdersQuerySchema>;
