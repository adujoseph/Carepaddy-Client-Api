import type { Request, Response, NextFunction } from 'express';
import { registerCarehome } from './register.service.js';
import type { RegisterCarehomeInput } from './register.schema.js';

export async function registerCarehomeController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = req.body as RegisterCarehomeInput;
    const result = await registerCarehome(body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}
