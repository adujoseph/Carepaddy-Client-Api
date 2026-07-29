import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '@middleware/auth';
import { login, logout, refresh } from './session.service.js';
import type { LoginInput, RefreshInput } from './session.schema.js';

export async function loginController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const body = req.body as LoginInput;
    const result = await login(body, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function refreshController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const body = req.body as RefreshInput;
    const result = await refresh(body.refreshToken);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function logoutController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const all = Boolean((req.body as { all?: boolean } | undefined)?.all);
    await logout({
      userId: req.auth.sub,
      sessionId: req.auth.sessionId,
      all,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
