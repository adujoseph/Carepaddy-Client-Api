import type { NextFunction, Request, Response } from 'express';
import { lookupCqc, type CqcLookupInput } from './cqc.service.js';

export async function cqcController(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await lookupCqc(req.body as CqcLookupInput, req.ip ?? 'unknown');
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
