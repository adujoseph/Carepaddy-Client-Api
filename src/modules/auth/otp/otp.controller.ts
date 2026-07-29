import type { NextFunction, Request, Response } from 'express';
import { initiateOtp, verifyOtp, type InitiateOtpInput, type VerifyOtpInput } from './otp.service.js';

export async function initiateOtpController(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await initiateOtp(req.body as InitiateOtpInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyOtpController(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await verifyOtp(req.body as VerifyOtpInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
