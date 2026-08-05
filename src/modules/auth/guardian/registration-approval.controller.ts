import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '@middleware/auth';
import type { RequestWithValidatedQuery } from '@middleware/validate';
import {
  listGuardianRegistrations,
  reviewGuardianRegistration,
  type ListGuardianRegistrationsQuery,
  type ReviewGuardianRegistrationInput,
} from './registration-approval.service.js';

export async function listGuardianRegistrationsController(
  req: AuthedRequest & RequestWithValidatedQuery<ListGuardianRegistrationsQuery>,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const result = await listGuardianRegistrations(req.validatedQuery!, {
      tenantId: req.auth.tenantId,
      userRole: req.auth.userRole,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function reviewGuardianRegistrationController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const rawId = req.params.id;
    const requestId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!requestId || typeof requestId !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing request id' } });
      return;
    }

    const result = await reviewGuardianRegistration(
      requestId,
      req.body as ReviewGuardianRegistrationInput,
      {
        userId: req.auth.sub,
        tenantId: req.auth.tenantId,
        userRole: req.auth.userRole,
      },
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
