import type { NextFunction, Request, Response } from 'express';
import { selfRegisterGuardian, type SelfRegisterInput } from './self-register.service.js';

export async function selfRegisterController(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await selfRegisterGuardian(req.body as SelfRegisterInput, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}
