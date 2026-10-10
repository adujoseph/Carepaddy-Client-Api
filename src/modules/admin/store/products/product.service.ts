import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import {
  decodeProductImageBase64,
  storeProductImage,
} from '@lib/storage/product-image.js';
import { parseBulkProductFile } from '@lib/store/bulk-import.js';
import {
  assertProductDescription,
  parseProductPrice,
  parseStockQuantity,
} from '@lib/store/validators.js';
import { writeAdminAuditLog } from '../../audit.service.js';
import type {
  BulkUploadInput,
  CreateProductInput,
  ListProductsQuery,
  UpdateProductInput,
} from './product.schema.js';
import { Prisma } from '../../../../generated/prisma/client.js';

function serializeProduct(product: {
  id: string;
  name: string;
  description: string;
  price: Prisma.Decimal;
  stockQuantity: number;
  imageUrl: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price.toString(),
    stockQuantity: product.stockQuantity,
    imageUrl: product.imageUrl,
    archived: product.archivedAt !== null,
    outOfStock: product.stockQuantity === 0 && product.archivedAt === null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

async function applyProductImage(
  productId: string,
  input: { imageBase64?: string; imageContentType?: string; removeImage?: boolean },
) {
  if (input.removeImage) {
    return null;
  }
  if (input.imageBase64) {
    if (!input.imageContentType) {
      throw new AppError(400, 'imageContentType is required with imageBase64', 'VALIDATION_ERROR');
    }
    const buffer = decodeProductImageBase64(input.imageBase64);
    return storeProductImage({ productId, buffer, contentType: input.imageContentType });
  }
  return undefined;
}

export async function listProducts(query: ListProductsQuery) {
  const skip = (query.page - 1) * query.limit;
  const search = query.search?.trim();

  const where = {
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.storeProduct.count({ where }),
    prisma.storeProduct.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    data: rows.map(serializeProduct),
  };
}

export async function getProduct(id: string) {
  const product = await prisma.storeProduct.findUnique({ where: { id } });
  if (!product) {
    throw new AppError(404, 'Product not found', 'NOT_FOUND');
  }
  return serializeProduct(product);
}

export async function createProduct(input: CreateProductInput, actorId: string) {
  const name = input.name.trim();
  const description = assertProductDescription(input.description);
  const price = parseProductPrice(input.price);
  const stockQuantity = parseStockQuantity(input.stockQuantity);

  const product = await prisma.storeProduct.create({
    data: {
      name,
      description,
      price,
      stockQuantity,
    },
  });

  const imagePatch = await applyProductImage(product.id, input);
  let saved = product;
  if (imagePatch !== undefined) {
    saved = await prisma.storeProduct.update({
      where: { id: product.id },
      data: { imageUrl: imagePatch },
    });
  }

  await writeAdminAuditLog({
    actorId,
    action: 'store.product.create',
    targetType: 'StoreProduct',
    targetId: saved.id,
    afterState: serializeProduct(saved),
  });

  return serializeProduct(saved);
}

export async function updateProduct(id: string, input: UpdateProductInput, actorId: string) {
  const before = await prisma.storeProduct.findUnique({ where: { id } });
  if (!before) {
    throw new AppError(404, 'Product not found', 'NOT_FOUND');
  }

  const data: Prisma.StoreProductUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = assertProductDescription(input.description);
  if (input.price !== undefined) data.price = parseProductPrice(input.price);
  if (input.stockQuantity !== undefined) data.stockQuantity = parseStockQuantity(input.stockQuantity);

  const imagePatch = await applyProductImage(id, input);
  if (imagePatch !== undefined) {
    data.imageUrl = imagePatch;
  }

  const product = await prisma.storeProduct.update({ where: { id }, data });

  await writeAdminAuditLog({
    actorId,
    action: 'store.product.update',
    targetType: 'StoreProduct',
    targetId: id,
    beforeState: serializeProduct(before),
    afterState: serializeProduct(product),
  });

  return serializeProduct(product);
}

export async function deleteProduct(id: string, actorId: string) {
  const product = await prisma.storeProduct.findUnique({ where: { id } });
  if (!product) {
    throw new AppError(404, 'Product not found', 'NOT_FOUND');
  }

  const referenceCount = await prisma.storeOrderLineItem.count({ where: { productId: id } });

  if (referenceCount === 0) {
    await prisma.storeProduct.delete({ where: { id } });
    await writeAdminAuditLog({
      actorId,
      action: 'store.product.delete',
      targetType: 'StoreProduct',
      targetId: id,
      beforeState: serializeProduct(product),
    });
    return { message: 'Product deleted', archived: false };
  }

  const archived = await prisma.storeProduct.update({
    where: { id },
    data: { archivedAt: new Date() },
  });

  await writeAdminAuditLog({
    actorId,
    action: 'store.product.archive',
    targetType: 'StoreProduct',
    targetId: id,
    beforeState: serializeProduct(product),
    afterState: serializeProduct(archived),
  });

  return { message: 'Product archived (referenced by existing orders)', archived: true };
}

export async function bulkCreateProducts(input: BulkUploadInput, actorId: string) {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.contentBase64, 'base64');
  } catch {
    throw new AppError(400, 'Invalid file encoding', 'INVALID_FILE');
  }

  const parsed = parseBulkProductFile(buffer, input.fileName);
  if (parsed.valid.length === 0 && parsed.errors.length > 0) {
    return { imported: 0, errors: parsed.errors };
  }

  const createdIds: string[] = [];
  for (const row of parsed.valid) {
    const product = await prisma.storeProduct.create({
      data: {
        name: row.name,
        description: row.description,
        price: row.price,
        stockQuantity: row.stockQuantity,
      },
    });
    createdIds.push(product.id);
  }

  await writeAdminAuditLog({
    actorId,
    action: 'store.product.bulk_import',
    targetType: 'StoreProduct',
    afterState: { importedCount: createdIds.length, productIds: createdIds },
  });

  return {
    imported: createdIds.length,
    errors: parsed.errors,
    productIds: createdIds,
  };
}
