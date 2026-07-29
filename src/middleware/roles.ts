import type { NextFunction, Response } from 'express';
import type { UserRole } from '../generated/prisma/client.js';
import { AppError } from '@middleware/error-handler';
import type { AuthedRequest } from '@middleware/auth';

export function requireRoles(...roles: UserRole[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.userRole)) {
      next(new AppError(403, 'You do not have permission to perform this action', 'FORBIDDEN'));
      return;
    }
    next();
  };
}

/** Guardians may hold tokens while links are pending; block staff-only actions already via roles. */
export function requireTenantContext(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (!req.auth?.tenantId) {
    next(new AppError(403, 'Tenant context required', 'FORBIDDEN'));
    return;
  }
  next();
}
