import { randomUUID } from 'node:crypto';
import * as jose from 'jose';
import { env } from '@config/env';
import { prisma } from '@lib/prisma';
import { generateJti } from '@lib/rateLimiter';
import { signStaffInviteToken, verifyStaffInviteToken } from '@lib/jwt';
import { assertPasswordPolicy, hashPassword } from '@lib/password';
import { normalizeEmail, normalizePhone } from '@lib/normalize';
import { AppError } from '@middleware/error-handler';
import { logger } from '@lib/logger';
import { emailSender } from '../../providers/notify.js';
import { createSessionForUser } from '../auth/session/session.service.js';
import { writeAdminAuditLog } from '../admin/audit.service.js';
import { scheduleCarehomeCqcCheck } from '../admin/carehomes/carehome.notifications.js';
import type {
  AcceptAdminInviteInput,
  InviteAdminInput,
  ListAdminsQuery,
} from './admin.schema.js';
import type { AccountStatus, UserRole } from '../../generated/prisma/client.js';

type CareAdminAuth = {
  userId: string;
  tenantId: string | null | undefined;
  userRole: string;
};

/** Map UI filter tabs → AccountStatus (or null for all). */
function toAccountStatus(uiStatus: ListAdminsQuery['status']): AccountStatus | null {
  switch (uiStatus) {
    case 'active':
      return 'active';
    case 'deactivated':
      return 'suspended';
    case 'invite_sent':
      return 'pending';
    default:
      return null;
  }
}

/** Map AccountStatus → UI badge label. */
function toUiStatus(status: AccountStatus): 'active' | 'deactivated' | 'invite_sent' | 'rejected' {
  switch (status) {
    case 'active':
      return 'active';
    case 'suspended':
      return 'deactivated';
    case 'pending':
      return 'invite_sent';
    case 'rejected':
      return 'rejected';
  }
}

function assertCareAdmin(auth: CareAdminAuth): string {
  if (!auth.tenantId || auth.userRole !== 'care_admin') {
    throw new AppError(403, 'Only care admins can manage staff', 'FORBIDDEN');
  }
  return auth.tenantId;
}

function serializeAdmin(user: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  profileImageUrl: string | null;
  userRole: UserRole;
  status: AccountStatus;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    profileImageUrl: user.profileImageUrl,
    role: user.userRole,
    status: toUiStatus(user.status),
    dateAdded: user.createdAt,
  };
}

export async function inviteAdmin(input: InviteAdminInput, auth: CareAdminAuth) {
  const tenantId = assertCareAdmin(auth);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const name = input.name.trim();
  const role = input.role;

  const carehome = await prisma.carehome.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!carehome) {
    throw new AppError(404, 'Carehome not found', 'NOT_FOUND');
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
  });
  if (existing) {
    throw new AppError(409, 'An account with this email or phone already exists', 'CONFLICT');
  }

  const jti = generateJti();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const placeholderPassword = await hashPassword(randomUUID());

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        phone,
        password: placeholderPassword,
        userType: 'client',
        userRole: role,
        status: 'pending',
        tenantId,
        isEmailVerified: true,
      },
    });

    const invite = await tx.staffInvite.create({
      data: {
        jti,
        userId: user.id,
        tenantId,
        email,
        invitedById: auth.userId,
        expiresAt,
      },
    });

    return { user, invite };
  });

  const token = await signStaffInviteToken({
    jti: result.invite.jti,
    userId: result.user.id,
    tenantId,
    email,
  });

  const link = `${env.appPublicUrl}/accept-admin-invite?token=${encodeURIComponent(token)}`;

  try {
    await emailSender.send({
      to: email,
      subject: `You're invited to join ${carehome.name} on CarePaddy`,
      body: [
        `Hi ${name},`,
        ``,
        `You've been invited as ${role === 'care_admin' ? 'an administrator' : 'care staff'} at ${carehome.name}.`,
        ``,
        `Accept your invitation and set your password:`,
        link,
        ``,
        `This link expires in 72 hours.`,
        ``,
        `— CarePaddy`,
      ].join('\n'),
    });
  } catch (err) {
    logger.warn({ err, userId: result.user.id }, 'admin invite email failed');
  }

  return {
    ...serializeAdmin(result.user),
    inviteExpiresAt: result.invite.expiresAt,
  };
}

export async function verifyAdminInvite(token: string) {
  let payload: Awaited<ReturnType<typeof verifyStaffInviteToken>>;
  try {
    payload = await verifyStaffInviteToken(token);
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new AppError(410, 'This invitation has expired', 'INVITE_EXPIRED');
    }
    throw new AppError(400, 'Invalid invitation token', 'INVALID_INVITE');
  }

  const invite = await prisma.staffInvite.findUnique({
    where: { jti: payload.jti },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          userRole: true,
          status: true,
          tenantId: true,
        },
      },
    },
  });

  if (!invite || invite.userId !== payload.userId) {
    throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
  }
  if (invite.used) {
    throw new AppError(409, 'This invitation has already been used', 'INVITE_USED');
  }
  if (invite.expiresAt <= new Date()) {
    throw new AppError(410, 'This invitation has expired', 'INVITE_EXPIRED');
  }
  if (invite.user.status !== 'pending') {
    throw new AppError(409, 'This invitation is no longer valid', 'INVITE_INVALID');
  }

  const carehome = await prisma.carehome.findUnique({
    where: { id: invite.tenantId },
    select: { id: true, name: true },
  });

  return {
    name: invite.user.name,
    email: invite.user.email,
    phone: invite.user.phone,
    role: invite.user.userRole,
    tenantId: invite.tenantId,
    carehomeName: carehome?.name ?? null,
  };
}

export async function acceptAdminInvite(
  input: AcceptAdminInviteInput,
  meta: { userAgent?: string; ip?: string },
) {
  await assertPasswordPolicy(input.password);

  let payload: Awaited<ReturnType<typeof verifyStaffInviteToken>>;
  try {
    payload = await verifyStaffInviteToken(input.inviteToken);
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new AppError(410, 'This invitation has expired', 'INVITE_EXPIRED');
    }
    throw new AppError(400, 'Invalid invitation token', 'INVALID_INVITE');
  }

  const invite = await prisma.staffInvite.findUnique({
    where: { jti: payload.jti },
    include: { user: true },
  });

  if (!invite || invite.userId !== payload.userId) {
    throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
  }
  if (invite.used) {
    throw new AppError(409, 'This invitation has already been used', 'INVITE_USED');
  }
  if (invite.expiresAt <= new Date()) {
    throw new AppError(410, 'This invitation has expired', 'INVITE_EXPIRED');
  }
  if (invite.user.status !== 'pending' || invite.user.tenantId !== payload.tenantId) {
    throw new AppError(409, 'This invitation is no longer valid', 'INVITE_INVALID');
  }

  const passwordHash = await hashPassword(input.password);
  let activatedCarehomeId: string | null = null;

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: invite.userId },
      data: {
        password: passwordHash,
        status: 'active',
        termsAcceptedAt: new Date(),
      },
    });

    await tx.staffInvite.update({
      where: { id: invite.id },
      data: { used: true, usedAt: new Date() },
    });

    // First care admin of a platform-admin-invited home: accepting activates the home itself.
    if (updated.userRole === 'care_admin' && updated.tenantId) {
      const now = new Date();
      const activated = await tx.carehome.updateMany({
        where: { id: updated.tenantId, status: 'pending' },
        data: {
          status: 'active',
          activatedAt: now,
          lastActivityAt: now,
          isEmailVerified: true,
          inviteSendFailedAt: null,
        },
      });
      if (activated.count > 0) {
        await tx.user.update({ where: { id: updated.id }, data: { isEmailVerified: true } });
        await writeAdminAuditLog(
          {
            actorId: null,
            action: 'carehome.invite.accepted',
            targetType: 'Carehome',
            targetId: updated.tenantId,
            afterState: { status: 'active', careAdminUserId: updated.id },
          },
          tx,
        );
        activatedCarehomeId = updated.tenantId;
      }
    }

    return updated;
  });

  if (activatedCarehomeId) {
    scheduleCarehomeCqcCheck(activatedCarehomeId);
  }

  const tokens = await createSessionForUser({
    userId: user.id,
    userRole: user.userRole,
    tenantId: user.tenantId,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  return {
    user: serializeAdmin(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

export async function listAdmins(query: ListAdminsQuery, auth: CareAdminAuth) {
  const tenantId = assertCareAdmin(auth);
  const status = toAccountStatus(query.status);
  const skip = (query.page - 1) * query.limit;

  const where = {
    tenantId,
    userRole: { in: ['care_admin', 'care_staff'] as UserRole[] },
    ...(status ? { status } : {}),
    ...(query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        profileImageUrl: true,
        userRole: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    data: rows.map(serializeAdmin),
  };
}

export async function getAdmin(adminId: string, auth: CareAdminAuth) {
  const tenantId = assertCareAdmin(auth);

  const user = await prisma.user.findFirst({
    where: {
      id: adminId,
      tenantId,
      userRole: { in: ['care_admin', 'care_staff'] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      profileImageUrl: true,
      userRole: true,
      status: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AppError(404, 'Administrator not found', 'NOT_FOUND');
  }

  return serializeAdmin(user);
}

async function loadManageableStaff(adminId: string, auth: CareAdminAuth) {
  const tenantId = assertCareAdmin(auth);

  if (adminId === auth.userId) {
    throw new AppError(400, 'You cannot perform this action on your own account', 'CANNOT_MODIFY_SELF');
  }

  const user = await prisma.user.findFirst({
    where: {
      id: adminId,
      tenantId,
      userRole: { in: ['care_admin', 'care_staff'] },
    },
  });

  if (!user) {
    throw new AppError(404, 'Administrator not found', 'NOT_FOUND');
  }

  if (user.userRole === 'care_admin') {
    const adminCount = await prisma.user.count({
      where: { tenantId, userRole: 'care_admin', status: { not: 'rejected' } },
    });
    if (adminCount <= 1) {
      throw new AppError(400, 'Cannot modify the only care admin', 'LAST_ADMIN');
    }
  }

  return user;
}

export async function suspendAdmin(adminId: string, auth: CareAdminAuth) {
  const user = await loadManageableStaff(adminId, auth);

  if (user.status === 'suspended') {
    throw new AppError(409, 'Administrator is already deactivated', 'ALREADY_SUSPENDED');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.user.update({
      where: { id: user.id },
      data: { status: 'suspended' },
    });
    await tx.session.updateMany({
      where: { userId: user.id, revoked: false },
      data: { revoked: true },
    });
    return next;
  });

  return serializeAdmin(updated);
}

export async function activateAdmin(adminId: string, auth: CareAdminAuth) {
  const user = await loadManageableStaff(adminId, auth);

  if (user.status === 'pending') {
    throw new AppError(400, 'Invite must be accepted before activation', 'INVITE_PENDING');
  }
  if (user.status === 'active') {
    throw new AppError(409, 'Administrator is already active', 'ALREADY_ACTIVE');
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { status: 'active' },
  });

  return serializeAdmin(updated);
}

export async function deleteAdmin(adminId: string, auth: CareAdminAuth) {
  const user = await loadManageableStaff(adminId, auth);

  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.failedLoginAttempt.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.staffInvite.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });

  return { message: 'Administrator deleted' };
}
