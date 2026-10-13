import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, type AccessTokenPayload } from '@lib/jwt';
import { requestContext } from '@lib/request-context';
import { AppError } from '@middleware/error-handler';
import { prisma } from '@lib/prisma';
import { isCarehomeDeactivated } from '@lib/carehome-status';

export const CAREHOME_DEACTIVATED_MESSAGE =
  'This care home has been deactivated on CarePaddy. Contact CarePaddy support for help.';

export type AuthedRequest = Request & {
  auth?: AccessTokenPayload;
};

export async function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const token = header.slice('Bearer '.length).trim();
    const payload = await verifyAccessToken(token);

    const session = await prisma.session.findUnique({ where: { id: payload.sessionId } });
    if (!session || session.revoked || session.expiresAt <= new Date()) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    if (payload.tenantId && (await isCarehomeDeactivated(payload.tenantId))) {
      throw new AppError(403, CAREHOME_DEACTIVATED_MESSAGE, 'CARE_HOME_DEACTIVATED');
    }

    req.auth = payload;
    requestContext.run(
      {
        userId: payload.sub,
        userRole: payload.userRole,
        sessionId: payload.sessionId,
        tenantId: payload.tenantId ?? null,
      },
      () => next(),
    );
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError(401, 'Authentication required', 'UNAUTHORIZED'));
  }
}
