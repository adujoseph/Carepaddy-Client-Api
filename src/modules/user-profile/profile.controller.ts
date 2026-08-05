import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '@middleware/auth';
import {
  changeUserPassword,
  disableAccount,
  getUserProfile,
  updateProfileImage,
  updateUserProfile,
} from './profile.service.js';
import type {
  ChangeUserPasswordInput,
  UpdateProfileImageInput,
  UpdateUserProfileInput,
} from './profile.schema.js';

function requireUserId(req: AuthedRequest, res: Response): string | null {
  if (!req.auth?.sub) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return null;
  }
  return req.auth.sub;
}

export async function getUserProfileController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const result = await getUserProfile(userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateUserProfileController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const result = await updateUserProfile(userId, req.body as UpdateUserProfileInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateProfileImageController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const result = await updateProfileImage(userId, req.body as UpdateProfileImageInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function changeUserPasswordController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const result = await changeUserPassword(userId, req.body as ChangeUserPasswordInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function disableAccountController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;
    const result = await disableAccount(userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
