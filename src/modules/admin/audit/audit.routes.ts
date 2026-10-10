import { Router } from 'express';
import { validateQuery, type RequestWithValidatedQuery } from '@middleware/validate';
import type { ListAuditLogsQuery } from './audit.schema.js';
import { requireAdminPermission } from '@middleware/admin-auth';
import { listAuditLogsQuerySchema } from './audit.schema.js';
import { listAuditLogs } from './audit.service.js';

export const adminAuditRouter = Router();

adminAuditRouter.get(
  '/audit-logs',
  requireAdminPermission('audit:read'),
  validateQuery(listAuditLogsQuerySchema),
  async (req: RequestWithValidatedQuery<ListAuditLogsQuery>, res, next) => {
    try {
      const result = await listAuditLogs(req.validatedQuery!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
