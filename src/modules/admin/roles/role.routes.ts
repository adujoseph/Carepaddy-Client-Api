import { Router } from 'express';
import { validateBody, validateQuery, type RequestWithValidatedQuery } from '@middleware/validate';
import type { ListRolesQuery } from './role.schema.js';
import { requireAdminPermission, type AdminAuthedRequest } from '@middleware/admin-auth';
import {
  createRoleSchema,
  listRolesQuerySchema,
  updateRolePermissionsSchema,
  updateRoleSchema,
} from './role.schema.js';
import {
  createRole,
  deleteRole,
  listPermissionCatalog,
  listRoles,
  updateRole,
  updateRolePermissions,
} from './role.service.js';

export const adminRolesRouter = Router();

adminRolesRouter.get('/permissions', (_req, res) => {
  res.status(200).json(listPermissionCatalog());
});

adminRolesRouter.get(
  '/roles',
  requireAdminPermission('roles:read'),
  validateQuery(listRolesQuerySchema),
  async (req: RequestWithValidatedQuery<ListRolesQuery>, res, next) => {
    try {
      const result = await listRoles(req.validatedQuery!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminRolesRouter.post(
  '/roles',
  requireAdminPermission('roles:write'),
  validateBody(createRoleSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await createRole(req.body, req.adminAuth!.sub);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminRolesRouter.patch(
  '/roles/:id',
  requireAdminPermission('roles:write'),
  validateBody(updateRoleSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const result = await updateRole(id, req.body, req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminRolesRouter.put(
  '/roles/:id/permissions',
  requireAdminPermission('roles:write'),
  validateBody(updateRolePermissionsSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const result = await updateRolePermissions(id, req.body, req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminRolesRouter.delete(
  '/roles/:id',
  requireAdminPermission('roles:write'),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const id = String(req.params.id);
      const result = await deleteRole(id, req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
