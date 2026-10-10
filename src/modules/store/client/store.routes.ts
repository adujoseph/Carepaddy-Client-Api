import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '@middleware/auth';
import { requireRoles } from '@middleware/roles';
import { validateBody, validateQuery, type RequestWithValidatedQuery } from '@middleware/validate';
import { registry } from '@docs/registry';
import {
  createStoreOrderSchema,
  guardianOrderDecisionSchema,
  listClientOrdersQuerySchema,
  listClientProductsQuerySchema,
  type CreateStoreOrderInput,
  type GuardianOrderDecisionInput,
  type ListClientOrdersQuery,
  type ListClientProductsQuery,
} from './store.schema.js';
import {
  createStoreOrder,
  getCarehomeStoreOrder,
  getGuardianStoreOrder,
  confirmStoreOrderDelivered,
  guardianDecideStoreOrder,
  listCarehomeStoreOrders,
  listGuardianStoreOrders,
  listStoreProductsForClient,
} from './store.service.js';
import type { NextFunction, Response } from 'express';

export const clientStoreRouter = Router();

registry.registerPath({
  method: 'get',
  path: '/client/store/products',
  tags: ['Store'],
  summary: 'List in-stock products for order composition (care home staff)',
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Product catalog' } },
});

registry.registerPath({
  method: 'post',
  path: '/client/store/orders',
  tags: ['Store'],
  summary: 'Create a store order for a resident (awaiting guardian approval)',
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Order created' } },
});

registry.registerPath({
  method: 'get',
  path: '/client/store/orders',
  tags: ['Store'],
  summary: 'List store orders (care home staff or guardian scope)',
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Order list' } },
});

registry.registerPath({
  method: 'get',
  path: '/client/store/orders/{id}',
  tags: ['Store'],
  summary: 'Order detail',
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Order detail' } },
});

registry.registerPath({
  method: 'post',
  path: '/client/store/orders/{id}/decision',
  tags: ['Store'],
  summary: 'Guardian approve or decline a new order',
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Decision recorded' } },
});

registry.registerPath({
  method: 'post',
  path: '/client/store/orders/{id}/confirm-delivery',
  tags: ['Store'],
  summary: 'Care home admin confirms order delivered (In Progress → Delivered)',
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Order marked delivered' } },
});

clientStoreRouter.get(
  '/store/products',
  requireAuth,
  requireRoles('care_admin', 'care_staff'),
  validateQuery(listClientProductsQuerySchema),
  async (req: RequestWithValidatedQuery<ListClientProductsQuery>, res, next) => {
    try {
      const result = await listStoreProductsForClient(req.validatedQuery!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

clientStoreRouter.post(
  '/store/orders',
  requireAuth,
  requireRoles('care_admin', 'care_staff'),
  validateBody(createStoreOrderSchema),
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await createStoreOrder(req.body as CreateStoreOrderInput, {
        userId: req.auth!.sub,
        tenantId: req.auth!.tenantId,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

clientStoreRouter.get(
  '/store/orders',
  requireAuth,
  validateQuery(listClientOrdersQuerySchema),
  async (req: AuthedRequest & RequestWithValidatedQuery<ListClientOrdersQuery>, res, next) => {
    try {
      const role = req.auth!.userRole;
      const query = req.validatedQuery!;
      if (role === 'guardian') {
        const result = await listGuardianStoreOrders(query, req.auth!.sub);
        res.status(200).json(result);
        return;
      }
      if (role === 'care_admin' || role === 'care_staff') {
        const result = await listCarehomeStoreOrders(query, req.auth!.tenantId);
        res.status(200).json(result);
        return;
      }
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    } catch (err) {
      next(err);
    }
  },
);

clientStoreRouter.get(
  '/store/orders/:id',
  requireAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const role = req.auth!.userRole;
      if (role === 'guardian') {
        const result = await getGuardianStoreOrder(id, req.auth!.sub);
        res.status(200).json(result);
        return;
      }
      if (role === 'care_admin' || role === 'care_staff') {
        const result = await getCarehomeStoreOrder(id, req.auth!.tenantId);
        res.status(200).json(result);
        return;
      }
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    } catch (err) {
      next(err);
    }
  },
);

clientStoreRouter.post(
  '/store/orders/:id/confirm-delivery',
  requireAuth,
  requireRoles('care_admin'),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await confirmStoreOrderDelivered(String(req.params.id), {
        userId: req.auth!.sub,
        tenantId: req.auth!.tenantId,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

clientStoreRouter.post(
  '/store/orders/:id/decision',
  requireAuth,
  requireRoles('guardian'),
  validateBody(guardianOrderDecisionSchema),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await guardianDecideStoreOrder(
        String(req.params.id),
        req.auth!.sub,
        req.body as GuardianOrderDecisionInput,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
