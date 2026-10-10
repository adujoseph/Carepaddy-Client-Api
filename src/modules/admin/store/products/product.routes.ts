import { Router } from 'express';
import { validateBody, validateQuery, type RequestWithValidatedQuery } from '@middleware/validate';
import { requireAdminPermission, type AdminAuthedRequest } from '@middleware/admin-auth';
import { BULK_PRODUCT_TEMPLATE_CSV } from '@lib/store/bulk-import.js';
import {
  bulkUploadSchema,
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
  type ListProductsQuery,
} from './product.schema.js';
import {
  bulkCreateProducts,
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from './product.service.js';

export const adminStoreProductsRouter = Router();

adminStoreProductsRouter.get(
  '/store/products/template',
  requireAdminPermission('product:edit'),
  (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="product-upload-template.csv"');
    res.status(200).send(BULK_PRODUCT_TEMPLATE_CSV);
  },
);

adminStoreProductsRouter.get(
  '/store/products',
  requireAdminPermission('product:view'),
  validateQuery(listProductsQuerySchema),
  async (req: RequestWithValidatedQuery<ListProductsQuery>, res, next) => {
    try {
      const result = await listProducts(req.validatedQuery!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminStoreProductsRouter.get(
  '/store/products/:id',
  requireAdminPermission('product:view'),
  async (req, res, next) => {
    try {
      const result = await getProduct(String(req.params.id));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminStoreProductsRouter.post(
  '/store/products',
  requireAdminPermission('product:edit'),
  validateBody(createProductSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await createProduct(req.body, req.adminAuth!.sub);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminStoreProductsRouter.post(
  '/store/products/bulk',
  requireAdminPermission('product:edit'),
  validateBody(bulkUploadSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await bulkCreateProducts(req.body, req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminStoreProductsRouter.patch(
  '/store/products/:id',
  requireAdminPermission('product:edit'),
  validateBody(updateProductSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await updateProduct(String(req.params.id), req.body, req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminStoreProductsRouter.delete(
  '/store/products/:id',
  requireAdminPermission('product:delete'),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await deleteProduct(String(req.params.id), req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
