import type { NextFunction, Response } from 'express';
import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import type { AuthedRequest } from '@middleware/auth';

/** Platform admin app users (`User.userType === admin`), not carehome care_admin. */
export async function requirePlatformAdmin(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    if (!req.auth) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth.sub },
      select: { userType: true, status: true },
    });

    if (!user || user.userType !== 'admin') {
      throw new AppError(403, 'Platform admin access required', 'FORBIDDEN');
    }

    if (user.status !== 'active') {
      throw new AppError(403, 'Account is not active', 'FORBIDDEN');
    }

    next();
  } catch (err) {
    next(err);
  }
}
