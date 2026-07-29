import type { NextFunction, Response } from 'express';
import type { RequestWithValidatedQuery } from '@middleware/validate';
import { listCarehomes, type ListCarehomesQuery } from './list.service.js';

export async function listCarehomesController(
  req: RequestWithValidatedQuery<ListCarehomesQuery>,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await listCarehomes(req.validatedQuery!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
