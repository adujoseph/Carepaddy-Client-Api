import { Router } from 'express';
import { z } from '@docs/zod-extend';
import { requireAuth } from '@middleware/auth';
import { requireRoles } from '@middleware/roles';
import { validateBody, validateQuery } from '@middleware/validate';
import { registry } from '@docs/registry';
import {
  acceptAdminInviteSchema,
  inviteAdminSchema,
  listAdminsQuerySchema,
  verifyAdminInviteQuerySchema,
} from './admin.schema.js';
import {
  acceptAdminInviteController,
  activateAdminController,
  deleteAdminController,
  getAdminController,
  inviteAdminController,
  listAdminsController,
  suspendAdminController,
  verifyAdminInviteController,
} from './admin.controller.js';

export const manageAdminRouter = Router();

const idParam = z.object({ id: z.uuid() });

registry.registerPath({
  method: 'post',
  path: '/client/admins/invite',
  tags: ['Manage Admin'],
  summary: 'Invite a care staff / admin by email (care_admin only)',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: inviteAdminSchema } } },
  },
  responses: {
    201: { description: 'Invitation created and email sent' },
    403: { description: 'Forbidden' },
    409: { description: 'Email or phone already exists' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/client/admins/invitations/verify',
  tags: ['Manage Admin'],
  summary: 'Verify a staff invite token (prefill accept form)',
  request: { query: verifyAdminInviteQuerySchema },
  responses: {
    200: { description: 'Invite valid' },
    410: { description: 'Expired' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/admins/invitations/accept',
  tags: ['Manage Admin'],
  summary: 'Accept staff invite and set password',
  request: {
    body: { content: { 'application/json': { schema: acceptAdminInviteSchema } } },
  },
  responses: {
    200: { description: 'Account activated and logged in' },
    410: { description: 'Expired' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/client/admins',
  tags: ['Manage Admin'],
  summary: 'List care staff / admins (filter by status, search by name)',
  security: [{ bearerAuth: [] }],
  request: { query: listAdminsQuerySchema },
  responses: {
    200: { description: 'Paginated admin list' },
    403: { description: 'Forbidden' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/client/admins/{id}',
  tags: ['Manage Admin'],
  summary: 'Get a single admin profile',
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: { description: 'Admin profile' },
    404: { description: 'Not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/admins/{id}/suspend',
  tags: ['Manage Admin'],
  summary: 'Deactivate (suspend) an admin',
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: { description: 'Admin deactivated' },
    400: { description: 'Cannot modify self / last admin' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/admins/{id}/activate',
  tags: ['Manage Admin'],
  summary: 'Re-activate a deactivated admin',
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: { description: 'Admin activated' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/client/admins/{id}',
  tags: ['Manage Admin'],
  summary: 'Delete an admin',
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: { description: 'Admin deleted' },
    400: { description: 'Cannot delete self / last admin' },
  },
});

manageAdminRouter.post(
  '/admins/invite',
  requireAuth,
  requireRoles('care_admin'),
  validateBody(inviteAdminSchema),
  inviteAdminController,
);
manageAdminRouter.get(
  '/admins/invitations/verify',
  validateQuery(verifyAdminInviteQuerySchema),
  verifyAdminInviteController,
);
manageAdminRouter.post(
  '/admins/invitations/accept',
  validateBody(acceptAdminInviteSchema),
  acceptAdminInviteController,
);
manageAdminRouter.get(
  '/admins',
  requireAuth,
  requireRoles('care_admin'),
  validateQuery(listAdminsQuerySchema),
  listAdminsController,
);
manageAdminRouter.get(
  '/admins/:id',
  requireAuth,
  requireRoles('care_admin'),
  getAdminController,
);
manageAdminRouter.post(
  '/admins/:id/suspend',
  requireAuth,
  requireRoles('care_admin'),
  suspendAdminController,
);
manageAdminRouter.post(
  '/admins/:id/activate',
  requireAuth,
  requireRoles('care_admin'),
  activateAdminController,
);
manageAdminRouter.delete(
  '/admins/:id',
  requireAuth,
  requireRoles('care_admin'),
  deleteAdminController,
);
