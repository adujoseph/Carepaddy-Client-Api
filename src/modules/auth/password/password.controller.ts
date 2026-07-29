import type { NextFunction, Request, Response } from 'express';
import {
  confirmPasswordReset,
  initiatePasswordReset,
  type ResetPasswordConfirmInput,
  type ResetPasswordInput,
} from './password.service.js';

export async function resetPasswordController(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await initiatePasswordReset(req.body as ResetPasswordInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordConfirmController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await confirmPasswordReset(req.body as ResetPasswordConfirmInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
