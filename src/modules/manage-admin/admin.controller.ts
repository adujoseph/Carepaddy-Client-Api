import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '@middleware/auth';
import type { RequestWithValidatedQuery } from '@middleware/validate';
import {
  acceptAdminInvite,
  activateAdmin,
  deleteAdmin,
  getAdmin,
  inviteAdmin,
  listAdmins,
  suspendAdmin,
  verifyAdminInvite,
} from './admin.service.js';
import type {
  AcceptAdminInviteInput,
  InviteAdminInput,
  ListAdminsQuery,
} from './admin.schema.js';

function authFrom(req: AuthedRequest) {
  return {
    userId: req.auth!.sub,
    tenantId: req.auth!.tenantId,
    userRole: req.auth!.userRole,
  };
}

function resolveId(req: AuthedRequest, res: Response): string | null {
  const raw = req.params.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing admin id' } });
    return null;
  }
  return id;
}

export async function inviteAdminController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const result = await inviteAdmin(req.body as InviteAdminInput, authFrom(req));
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyAdminInviteController(
  req: RequestWithValidatedQuery<{ token: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await verifyAdminInvite(req.validatedQuery!.token);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function acceptAdminInviteController(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await acceptAdminInvite(req.body as AcceptAdminInviteInput, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listAdminsController(
  req: AuthedRequest & RequestWithValidatedQuery<ListAdminsQuery>,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const result = await listAdmins(req.validatedQuery!, authFrom(req));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getAdminController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const id = resolveId(req, res);
    if (!id) return;
    const result = await getAdmin(id, authFrom(req));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function suspendAdminController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const id = resolveId(req, res);
    if (!id) return;
    const result = await suspendAdmin(id, authFrom(req));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function activateAdminController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const id = resolveId(req, res);
    if (!id) return;
    const result = await activateAdmin(id, authFrom(req));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function deleteAdminController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.auth) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    const id = resolveId(req, res);
    if (!id) return;
    const result = await deleteAdmin(id, authFrom(req));
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
