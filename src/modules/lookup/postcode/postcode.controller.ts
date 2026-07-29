import type { NextFunction, Response } from 'express';
import type { RequestWithValidatedQuery } from '@middleware/validate';
import { lookupPostcode, type PostcodeQuery } from './postcode.service.js';

export async function postcodeController(
  req: RequestWithValidatedQuery<PostcodeQuery>,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await lookupPostcode(req.validatedQuery!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
