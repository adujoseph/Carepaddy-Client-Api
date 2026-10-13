import type { NextFunction, Response } from 'express';
import { verifyAdminAccessToken } from '@lib/admin-jwt';
import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import {
  assertAdminSessionActive,
  touchAdminSessionActivity,
} from '@lib/admin-session';
import {
  loadAdminContext,
  superAdminRequiresMfa,
  type AdminContext,
} from '@modules/admin/admin-context.js';
import type { AdminPermission } from '@modules/admin/permissions.js';
import { SUPER_ADMIN_ROLE_NAME } from '@modules/admin/permissions.js';
import { writeAdminAuditLog } from '@modules/admin/audit.service.js';
import type { Request } from 'express';

export type AdminAuthedRequest = Request & {
  adminAuth?: { sub: string; sessionId: string };
  admin?: AdminContext;
};

export async function requireAdminAuth(req: AdminAuthedRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const token = header.slice('Bearer '.length).trim();
    const payload = await verifyAdminAccessToken(token);

    const session = await prisma.adminSession.findUnique({ where: { id: payload.sessionId } });
    if (!session || session.adminUserId !== payload.sub) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    await assertAdminSessionActive(session);

    const admin = await loadAdminContext(payload.sub);
    if (!admin || admin.status === 'DEACTIVATED') {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    void touchAdminSessionActivity(session);

    req.adminAuth = { sub: payload.sub, sessionId: payload.sessionId };
    req.admin = admin;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError(401, 'Authentication required', 'UNAUTHORIZED'));
  }
}

/** Block all routes except change-password while mustChangePassword is true. */
export function blockUntilPasswordChanged(req: AdminAuthedRequest, _res: Response, next: NextFunction) {
  if (req.admin?.mustChangePassword) {
    next(
      new AppError(
        403,
        'You must change your password before continuing',
        'PASSWORD_CHANGE_REQUIRED',
      ),
    );
    return;
  }
  next();
}

/** SUPER_ADMIN must enroll MFA before using the back office (mirrors password gate). */
export function blockUntilMfaEnrolled(req: AdminAuthedRequest, _res: Response, next: NextFunction) {
  if (req.admin && superAdminRequiresMfa(req.admin)) {
    next(
      new AppError(
        403,
        'SUPER_ADMIN accounts must enroll MFA before continuing',
        'MFA_ENROLLMENT_REQUIRED',
      ),
    );
    return;
  }
  next();
}

export function requireAdminPermission(...required: AdminPermission[]) {
  return (req: AdminAuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.admin) {
      next(new AppError(401, 'Authentication required', 'UNAUTHORIZED'));
      return;
    }
    if (req.admin.role.name.toUpperCase() === SUPER_ADMIN_ROLE_NAME) {
      next();
      return;
    }
    const hasAll = required.every((p) => req.admin!.permissions.includes(p));
    if (!hasAll) {
      void writeAdminAuditLog({
        actorId: req.admin.id,
        action: 'authz.permission_denied',
        targetType: 'AdminPermission',
        afterState: { required, path: req.path, method: req.method },
      });
      next(
        new AppError(
          403,
          'You do not have permission to perform this action',
          'INSUFFICIENT_PERMISSION',
          { required },
        ),
      );
      return;
    }
    next();
  };
}
