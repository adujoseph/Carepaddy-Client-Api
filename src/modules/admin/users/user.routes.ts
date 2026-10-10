import { Router } from 'express';
import { validateBody, validateQuery, type RequestWithValidatedQuery } from '@middleware/validate';
import type { ListAdminUsersQuery } from './user.schema.js';
import { requireAdminPermission, type AdminAuthedRequest } from '@middleware/admin-auth';
import {
  createAdminUserSchema,
  listAdminUsersQuerySchema,
  reassignRoleSchema,
} from './user.schema.js';
import {
  createAdminUser,
  deactivateAdminUser,
  getAdminUser,
  listAdminUsers,
  reactivateAdminUser,
  reassignAdminRole,
  resendAdminInvite,
} from './user.service.js';
import { removeMfaForAdminByActor } from '../mfa/mfa.service.js';

export const adminUsersRouter = Router();

adminUsersRouter.get(
  '/admins',
  requireAdminPermission('admins:read'),
  validateQuery(listAdminUsersQuerySchema),
  async (req: RequestWithValidatedQuery<ListAdminUsersQuery>, res, next) => {
    try {
      const result = await listAdminUsers(req.validatedQuery!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminUsersRouter.get(
  '/admins/:id',
  requireAdminPermission('admins:read'),
  async (req, res, next) => {
    try {
      const result = await getAdminUser(String(req.params.id));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminUsersRouter.post(
  '/admins',
  requireAdminPermission('admins:write'),
  validateBody(createAdminUserSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await createAdminUser(req.body, req.adminAuth!.sub);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminUsersRouter.post(
  '/admins/:id/resend-invite',
  requireAdminPermission('admins:write'),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await resendAdminInvite(String(req.params.id), req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminUsersRouter.post(
  '/admins/:id/deactivate',
  requireAdminPermission('admins:write'),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await deactivateAdminUser(String(req.params.id), req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminUsersRouter.post(
  '/admins/:id/reactivate',
  requireAdminPermission('admins:write'),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await reactivateAdminUser(String(req.params.id), req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminUsersRouter.patch(
  '/admins/:id/role',
  requireAdminPermission('admins:write'),
  validateBody(reassignRoleSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await reassignAdminRole(String(req.params.id), req.body, req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminUsersRouter.post(
  '/admins/:id/mfa/remove',
  requireAdminPermission('admins:write'),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await removeMfaForAdminByActor(String(req.params.id), req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
