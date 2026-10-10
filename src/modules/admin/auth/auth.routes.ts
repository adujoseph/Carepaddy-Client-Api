import { Router } from 'express';
import { validateBody, validateQuery } from '@middleware/validate';
import {
  requireAdminAuth,
  blockUntilPasswordChanged,
  blockUntilMfaEnrolled,
  type AdminAuthedRequest,
} from '@middleware/admin-auth';
import {
  acceptAdminInviteSchema,
  adminChangePasswordSchema,
  adminForgotPasswordSchema,
  adminLoginSchema,
  adminResetPasswordSchema,
  verifyAdminInviteQuerySchema,
} from './auth.schema.js';
import {
  acceptAdminInvite,
  adminChangePassword,
  adminForgotPassword,
  adminLogin,
  adminResetPasswordConfirm,
  getAdminMe,
  revokeAllAdminSessionsForUser,
  verifyAdminInvite,
} from './auth.service.js';
import type { NextFunction, Response } from 'express';
import type { RequestWithValidatedQuery } from '@middleware/validate';

export const adminAuthRouter = Router();

adminAuthRouter.post('/auth/login', validateBody(adminLoginSchema), async (req, res, next) => {
  try {
    const result = await adminLogin(req.body, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

adminAuthRouter.post(
  '/auth/forgot-password',
  validateBody(adminForgotPasswordSchema),
  async (req, res, next) => {
    try {
      const result = await adminForgotPassword(req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminAuthRouter.post(
  '/auth/reset-password/confirm',
  validateBody(adminResetPasswordSchema),
  async (req, res, next) => {
    try {
      const result = await adminResetPasswordConfirm(req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminAuthRouter.get(
  '/admins/invitations/verify',
  validateQuery(verifyAdminInviteQuerySchema),
  async (req: RequestWithValidatedQuery<{ token: string }>, res, next) => {
    try {
      const result = await verifyAdminInvite(req.validatedQuery!.token);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminAuthRouter.post(
  '/admins/invitations/accept',
  validateBody(acceptAdminInviteSchema),
  async (req, res, next) => {
    try {
      const result = await acceptAdminInvite(req.body, {
        userAgent: req.get('user-agent') ?? undefined,
        ip: req.ip,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminAuthRouter.post(
  '/auth/change-password',
  requireAdminAuth,
  validateBody(adminChangePasswordSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await adminChangePassword(req.adminAuth!.sub, req.adminAuth!.sessionId, req.body, {
        userAgent: req.get('user-agent') ?? undefined,
        ip: req.ip,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/** All routes below require auth, password changed, and MFA enrolled (SUPER_ADMIN). */
export const adminProtectedRouter = Router();
adminProtectedRouter.use(requireAdminAuth, blockUntilPasswordChanged, blockUntilMfaEnrolled);

adminProtectedRouter.get('/me', async (req: AdminAuthedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await getAdminMe(req.adminAuth!.sub);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

adminProtectedRouter.post(
  '/auth/sessions/revoke-all',
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await revokeAllAdminSessionsForUser(req.adminAuth!.sub);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
