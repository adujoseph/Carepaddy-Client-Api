import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '@middleware/auth';
import type { RequestWithValidatedQuery } from '@middleware/validate';
import {
  completeInvitation,
  createInvitation,
  verifyInvitation,
  type CompleteInvitationInput,
  type CreateInvitationInput,
} from './invitation.service.js';

export async function createInvitationController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const result = await createInvitation(req.body as CreateInvitationInput, {
      userId: req.auth.sub,
      tenantId: req.auth.tenantId,
      userRole: req.auth.userRole,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyInvitationController(
  req: RequestWithValidatedQuery<{ token: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await verifyInvitation(req.validatedQuery!.token);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function completeInvitationController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await completeInvitation(req.body as CompleteInvitationInput, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}
