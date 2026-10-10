import { Router } from 'express';
import { validateBody } from '@middleware/validate';
import {
  requireAdminAuth,
  blockUntilPasswordChanged,
  type AdminAuthedRequest,
} from '@middleware/admin-auth';
import {
  mfaEnrollConfirmSchema,
  mfaEnrollStartSchema,
  mfaRegenerateRecoverySchema,
  mfaRemoveSelfSchema,
  mfaVerifyLoginSchema,
} from './mfa.schema.js';
import {
  confirmMfaEnrollment,
  regenerateRecoveryCodes,
  removeMfaSelf,
  startMfaEnrollment,
  verifyMfaLogin,
} from './mfa.service.js';

export const adminMfaPublicRouter = Router();

adminMfaPublicRouter.post(
  '/auth/mfa/verify-login',
  validateBody(mfaVerifyLoginSchema),
  async (req, res, next) => {
    try {
      const result = await verifyMfaLogin(req.body, {
        userAgent: req.get('user-agent') ?? undefined,
        ip: req.ip,
      });
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/** MFA setup: requires auth + password changed; not blocked by MFA enrollment gate. */
export const adminMfaSetupRouter = Router();
adminMfaSetupRouter.use(requireAdminAuth, blockUntilPasswordChanged);

adminMfaSetupRouter.post(
  '/auth/mfa/enroll/start',
  validateBody(mfaEnrollStartSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await startMfaEnrollment(req.adminAuth!.sub, req.body.currentPassword);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminMfaSetupRouter.post(
  '/auth/mfa/enroll/confirm',
  validateBody(mfaEnrollConfirmSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await confirmMfaEnrollment(req.adminAuth!.sub, req.body.totpCode);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminMfaSetupRouter.post(
  '/auth/mfa/recovery/regenerate',
  validateBody(mfaRegenerateRecoverySchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await regenerateRecoveryCodes(
        req.adminAuth!.sub,
        req.body.currentPassword,
        req.body.totpCode,
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

adminMfaSetupRouter.delete(
  '/auth/mfa',
  validateBody(mfaRemoveSelfSchema),
  async (req: AdminAuthedRequest, res, next) => {
    try {
      const result = await removeMfaSelf(req.adminAuth!.sub, req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
