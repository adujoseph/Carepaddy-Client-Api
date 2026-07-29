import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '@lib/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code: string = 'ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function isJsonBodyParseError(err: unknown): boolean {
  if (!(err instanceof SyntaxError)) return false;
  const withStatus = err as SyntaxError & {
    status?: number;
    statusCode?: number;
    type?: string;
  };
  return (
    withStatus.status === 400 ||
    withStatus.statusCode === 400 ||
    withStatus.type === 'entity.parse.failed'
  );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (isJsonBodyParseError(err)) {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body must be valid JSON',
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong' },
  });
}
