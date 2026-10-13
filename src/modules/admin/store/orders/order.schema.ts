import { z } from '@docs/zod-extend';

/** Tabs on the Order Request screen, plus pending_delivery (approved, not yet dispatched). */
export const storeOrderStatusFilterSchema = z.enum([
  'all',
  'pending_review',
  'on_the_way',
  'delivered',
  'rejected',
  'pending_delivery',
]);

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const listStoreOrdersQuerySchema = z.object({
  search: z.string().trim().max(200).optional().openapi({ description: 'Order ID or care home name' }),
  status: storeOrderStatusFilterSchema.optional().default('all'),
  from: day.optional().openapi({ description: 'Request date from, inclusive (YYYY-MM-DD, UTC)' }),
  to: day.optional().openapi({ description: 'Request date to, inclusive (YYYY-MM-DD, UTC)' }),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ListStoreOrdersQuery = z.infer<typeof listStoreOrdersQuerySchema>;
