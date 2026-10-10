import { z } from '@docs/zod-extend';

const imagePayload = z.object({
  imageBase64: z.string().min(1).optional(),
  imageContentType: z.enum(['image/jpeg', 'image/jpg', 'image/png']).optional(),
  removeImage: z.boolean().optional(),
});

export const listProductsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
});

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1),
    price: z.union([z.string(), z.number()]),
    stockQuantity: z.coerce.number().int().min(0),
  })
  .merge(imagePayload);

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).optional(),
    price: z.union([z.string(), z.number()]).optional(),
    stockQuantity: z.coerce.number().int().min(0).optional(),
  })
  .merge(imagePayload)
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.price !== undefined ||
      v.stockQuantity !== undefined ||
      v.imageBase64 !== undefined ||
      v.removeImage === true,
    { message: 'At least one field is required' },
  );

export const bulkUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type BulkUploadInput = z.infer<typeof bulkUploadSchema>;
