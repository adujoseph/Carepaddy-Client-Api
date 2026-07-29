import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

export type RequestWithValidatedQuery<T = unknown> = Request & {
  validatedQuery?: T;
};

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>) {
  return (req: RequestWithValidatedQuery<T>, _res: Response, next: NextFunction) => {
    req.validatedQuery = schema.parse(req.query);
    next();
  };
}
