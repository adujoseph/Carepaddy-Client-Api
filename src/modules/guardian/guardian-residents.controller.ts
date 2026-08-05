import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '@middleware/auth';
import { listGuardianResidents } from './guardian-residents.service.js';

export async function listGuardianResidentsController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const result = await listGuardianResidents(req.auth.sub, req.auth.userRole);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
