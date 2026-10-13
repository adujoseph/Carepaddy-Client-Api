import { Router } from 'express';
import { z } from '@docs/zod-extend';
import { registry } from '@docs/registry';
import { adminAuthRouter, adminProtectedRouter } from './auth/auth.routes.js';
import { adminMfaPublicRouter, adminMfaSetupRouter } from './mfa/mfa.routes.js';
import { adminRolesRouter } from './roles/role.routes.js';
import { adminUsersRouter } from './users/user.routes.js';
import { adminAuditRouter } from './audit/audit.routes.js';
import { adminStoreProductsRouter } from './store/products/product.routes.js';
import { adminStoreOrdersRouter } from './store/orders/order.routes.js';
import { adminCarehomesRouter } from './carehomes/carehome.routes.js';
import {
  acceptAdminInviteSchema,
  adminChangePasswordSchema,
  adminForgotPasswordSchema,
  adminLoginSchema,
  adminResetPasswordSchema,
} from './auth/auth.schema.js';
import { createRoleSchema, listRolesQuerySchema } from './roles/role.schema.js';
import { createAdminUserSchema, listAdminUsersQuerySchema, reassignRoleSchema } from './users/user.schema.js';
import { listAuditLogsQuerySchema } from './audit/audit.schema.js';
import {
  bulkUploadSchema,
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from './store/products/product.schema.js';
import { listStoreOrdersQuerySchema } from './store/orders/order.schema.js';

export const adminModuleRouter = Router();

const adminHealthSchema = z.object({
  status: z.literal('ok'),
  namespace: z.literal('admin'),
  timestamp: z.string(),
});

registry.registerPath({
  method: 'get',
  path: '/admin/health',
  tags: ['Admin'],
  summary: 'Admin API liveness',
  responses: {
    200: {
      description: 'OK',
      content: { 'application/json': { schema: adminHealthSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/auth/login',
  tags: ['Admin Auth'],
  request: { body: { content: { 'application/json': { schema: adminLoginSchema } } } },
  responses: { 200: { description: 'Logged in with me payload' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/me',
  tags: ['Admin Auth'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Current admin + permissions' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/auth/change-password',
  tags: ['Admin Auth'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: adminChangePasswordSchema } } } },
  responses: { 200: { description: 'Password changed; new tokens issued' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/auth/mfa/verify-login',
  tags: ['Admin Auth'],
  responses: { 200: { description: 'MFA verified; session issued' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/auth/sessions/revoke-all',
  tags: ['Admin Auth'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'All sessions revoked' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/auth/forgot-password',
  tags: ['Admin Auth'],
  request: { body: { content: { 'application/json': { schema: adminForgotPasswordSchema } } } },
  responses: { 200: { description: 'Generic success' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/auth/reset-password/confirm',
  tags: ['Admin Auth'],
  request: { body: { content: { 'application/json': { schema: adminResetPasswordSchema } } } },
  responses: { 200: { description: 'Password reset' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/admins/invitations/accept',
  tags: ['Admin Users'],
  request: { body: { content: { 'application/json': { schema: acceptAdminInviteSchema } } } },
  responses: { 200: { description: 'Invite accepted' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/permissions',
  tags: ['Admin Roles'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Permission catalog' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/roles',
  tags: ['Admin Roles'],
  security: [{ bearerAuth: [] }],
  request: { query: listRolesQuerySchema },
  responses: { 200: { description: 'Role list' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/roles',
  tags: ['Admin Roles'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createRoleSchema } } } },
  responses: { 201: { description: 'Role created' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/admins',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  request: { query: listAdminUsersQuerySchema },
  responses: { 200: { description: 'Admin user list' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/admins',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: createAdminUserSchema } } } },
  responses: { 201: { description: 'Admin invited' } },
});

registry.registerPath({
  method: 'patch',
  path: '/admin/admins/{id}/role',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: reassignRoleSchema } } } },
  responses: { 200: { description: 'Role reassigned' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/audit-logs',
  tags: ['Admin Audit'],
  security: [{ bearerAuth: [] }],
  request: { query: listAuditLogsQuerySchema },
  responses: { 200: { description: 'Audit log list' } },
});

const idParam = z.object({ id: z.string() });

registry.registerPath({
  method: 'get',
  path: '/admin/store/products/template',
  tags: ['Admin Store Products'],
  security: [{ bearerAuth: [] }],
  summary: 'Download bulk upload CSV template (product:edit)',
  responses: { 200: { description: 'CSV template', content: { 'text/csv': { schema: z.string() } } } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/store/products',
  tags: ['Admin Store Products'],
  security: [{ bearerAuth: [] }],
  summary: 'List products (product:view)',
  request: { query: listProductsQuerySchema },
  responses: { 200: { description: 'Paginated product list' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/store/products/{id}',
  tags: ['Admin Store Products'],
  security: [{ bearerAuth: [] }],
  summary: 'Get product (product:view)',
  request: { params: idParam },
  responses: { 200: { description: 'Product' }, 404: { description: 'Not found' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/store/products',
  tags: ['Admin Store Products'],
  security: [{ bearerAuth: [] }],
  summary: 'Create product (product:edit)',
  request: { body: { content: { 'application/json': { schema: createProductSchema } } } },
  responses: { 201: { description: 'Product created' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/store/products/bulk',
  tags: ['Admin Store Products'],
  security: [{ bearerAuth: [] }],
  summary: 'Bulk create products from base64 CSV (product:edit)',
  request: { body: { content: { 'application/json': { schema: bulkUploadSchema } } } },
  responses: { 200: { description: 'Bulk import result' } },
});

registry.registerPath({
  method: 'patch',
  path: '/admin/store/products/{id}',
  tags: ['Admin Store Products'],
  security: [{ bearerAuth: [] }],
  summary: 'Update product (product:edit)',
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: updateProductSchema } } },
  },
  responses: { 200: { description: 'Product updated' } },
});

registry.registerPath({
  method: 'delete',
  path: '/admin/store/products/{id}',
  tags: ['Admin Store Products'],
  security: [{ bearerAuth: [] }],
  summary: 'Delete product (product:delete)',
  request: { params: idParam },
  responses: { 200: { description: 'Product deleted' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/store/orders/stats',
  tags: ['Admin Store Orders'],
  security: [{ bearerAuth: [] }],
  summary: 'Order Request counters (store-order:view)',
  description: 'totalOrders, awaitingFamilyReview (Pending Review), rejected, delivered, plus onTheWay and pendingDelivery.',
  responses: { 200: { description: 'Order stats' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/store/orders',
  tags: ['Admin Store Orders'],
  security: [{ bearerAuth: [] }],
  summary: 'Order Request list (store-order:view)',
  description:
    'Columns: orderId, carehome, familyContact (guardian phone, null when none), itemCount, date, statusLabel. Tabs: all, pending_review, on_the_way, delivered, rejected. Search matches order ID (with or without #) or care home name. from/to filter the request date.',
  request: { query: listStoreOrdersQuerySchema },
  responses: { 200: { description: 'Paginated order list' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/store/orders/{id}',
  tags: ['Admin Store Orders'],
  security: [{ bearerAuth: [] }],
  summary: 'Order summary (store-order:view)',
  description: 'Family contact, status, request date, order ID, item count, items price, delivery fee, VAT percent, total, and line items.',
  request: { params: idParam },
  responses: { 200: { description: 'Order' }, 404: { description: 'Not found' } },
});

registry.registerPath({
  method: 'get',
  path: '/admin/store/orders/{id}/status-history',
  tags: ['Admin Store Orders'],
  security: [{ bearerAuth: [] }],
  summary: 'Order status history (store-order:view)',
  request: { params: idParam },
  responses: { 200: { description: 'Status history' } },
});

registry.registerPath({
  method: 'post',
  path: '/admin/store/orders/{id}/send-for-delivery',
  tags: ['Admin Store Orders'],
  security: [{ bearerAuth: [] }],
  summary: 'Send order for delivery (store-order:fulfill)',
  request: { params: idParam },
  responses: { 200: { description: 'Order sent for delivery' } },
});

adminModuleRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    namespace: 'admin',
    timestamp: new Date().toISOString(),
  });
});

adminModuleRouter.use(adminAuthRouter);
adminModuleRouter.use(adminMfaPublicRouter);
adminModuleRouter.use(adminMfaSetupRouter);

adminModuleRouter.use(adminProtectedRouter);
adminProtectedRouter.use(adminRolesRouter);
adminProtectedRouter.use(adminUsersRouter);
adminProtectedRouter.use(adminAuditRouter);
adminProtectedRouter.use(adminStoreProductsRouter);
adminProtectedRouter.use(adminStoreOrdersRouter);
adminProtectedRouter.use(adminCarehomesRouter);
