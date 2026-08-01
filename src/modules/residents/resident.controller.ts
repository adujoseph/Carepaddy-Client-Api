import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '@middleware/auth';
import {
  createResident,
  listResidents,
  type CreateResidentInput,
} from './resident.service.js';

export async function createResidentController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const result = await createResident(req.body as CreateResidentInput, {
      tenantId: req.auth.tenantId,
      userRole: req.auth.userRole,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listResidentsController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const result = await listResidents({
      tenantId: req.auth.tenantId,
      userRole: req.auth.userRole,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
