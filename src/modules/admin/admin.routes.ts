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
