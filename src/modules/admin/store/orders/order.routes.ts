import { Router } from 'express';
import { validateQuery, type RequestWithValidatedQuery } from '@middleware/validate';
import { requireAdminPermission, type AdminAuthedRequest } from '@middleware/admin-auth';
import { listStoreOrdersQuerySchema, type ListStoreOrdersQuery } from './order.schema.js';
import {
  getStoreOrder,
  getStoreOrderStats,
  getStoreOrderStatusHistory,
  listStoreOrders,
  sendStoreOrderForDelivery,
} from './order.service.js';

export const adminStoreOrdersRouter = Router();

adminStoreOrdersRouter.get(
  '/store/orders/stats',
  requireAdminPermission('store-order:view'),
  async (_req, res, next) => {
    try {
      const result = await getStoreOrderStats();
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminStoreOrdersRouter.get(
  '/store/orders',
  requireAdminPermission('store-order:view'),
  validateQuery(listStoreOrdersQuerySchema),
  async (req: RequestWithValidatedQuery<ListStoreOrdersQuery>, res, next) => {
    try {
      const result = await listStoreOrders(req.validatedQuery!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminStoreOrdersRouter.get(
  '/store/orders/:id/status-history',
  requireAdminPermission('store-order:view'),
  async (req, res, next) => {
    try {
      const result = await getStoreOrderStatusHistory(String(req.params.id));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminStoreOrdersRouter.get(
  '/store/orders/:id',
  requireAdminPermission('store-order:view'),
  async (req, res, next) => {
    try {
      const result = await getStoreOrder(String(req.params.id));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminStoreOrdersRouter.post(
  '/store/orders/:id/send-for-delivery',
  requireAdminPermission('store-order:fulfill'),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await sendStoreOrderForDelivery(String(req.params.id), req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
