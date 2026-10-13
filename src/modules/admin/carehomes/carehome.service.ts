import { randomUUID } from 'node:crypto';
import { z } from '@docs/zod-extend';
import { prisma } from '@lib/prisma';
import { signStaffInviteToken } from '@lib/jwt';
import { normalizeEmail } from '@lib/normalize';
import { hashPassword } from '@lib/password';
import { generateJti } from '@lib/rateLimiter';
import {
  CAREHOME_STATUSES,
  OPEN_STORE_ORDER_STATUSES,
  carehomeStatusWhere,
  computeCarehomeStatus,
  type CarehomeStatus,
} from '@lib/carehome-status';
import { AppError } from '@middleware/error-handler';
import { Prisma, type Carehome } from '../../../generated/prisma/client.js';
import { writeAdminAuditLog } from '../audit.service.js';
import {
  notifyCarehomeStatusChange,
  scheduleCarehomeCqcCheck,
  sendCarehomeEmailChangedNotice,
  sendCarehomeInviteEmail,
} from './carehome.notifications.js';
import { normalizeUkPhone } from './carehome.schema.js';
import type {
  ActivateCarehomeInput,
  CreateCarehomeInput,
  DeactivateCarehomeInput,
  ListCarehomeRoomsQuery,
  ListCarehomesQuery,
  MarkCarehomeActiveInput,
  MarkCarehomeInactiveInput,
  UpdateCarehomeInput,
} from './carehome.schema.js';

const INVITE_TTL_DAYS = 7;
const INVITE_RESENDS_PER_HOUR = 3;
const OPEN_ORDER_SAMPLE_SIZE = 10;
const HISTORY_LIMIT = 50;
const TARGET_TYPE = 'Carehome';

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function serializeCarehome(home: Carehome, now = new Date()) {
  return {
    id: home.id,
    name: home.name,
    cqcNumber: home.cqcNumber,
    email: home.email,
    phone: home.phone,
    address:
      home.addressLine || home.city || home.postcode
        ? { addressLine: home.addressLine, city: home.city, postcode: home.postcode }
        : null,
    status: computeCarehomeStatus(home, now),
    cqcVerified: home.cqcCheck,
    cqcCheckedAt: home.cqcCheckedAt,
    isEmailVerified: home.isEmailVerified,
    isPhoneVerified: home.isPhoneVerified,
    inviteDeliveryFailed: Boolean(home.inviteSendFailedAt),
    activatedAt: home.activatedAt,
    lastActivityAt: home.lastActivityAt,
    version: home.version,
    createdAt: home.createdAt,
    updatedAt: home.updatedAt,
  };
}

function auditSnapshot(home: Carehome) {
  return {
    name: home.name,
    email: home.email,
    phone: home.phone,
    cqcNumber: home.cqcNumber,
    status: computeCarehomeStatus(home),
  };
}

// ---------------------------------------------------------------------------
// Lookups and guards
// ---------------------------------------------------------------------------

function notFound(): AppError {
  return new AppError(404, 'Care home not found', 'NOT_FOUND');
}

async function loadCarehomeOrThrow(id: string, client: Tx | typeof prisma = prisma) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const home = await client.carehome.findUnique({ where: { id } });
  if (!home) throw notFound();
  return home;
}

/** Row lock shared with order creation (FOR SHARE) so deactivation and new orders serialise. */
async function lockCarehomeOrThrow(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Carehome" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw notFound();
  return tx.carehome.findUniqueOrThrow({ where: { id } });
}

/** The care admin whose login is the care home email (the account created by the invite). */
async function findPrimaryCareAdmin(client: Tx | typeof prisma, home: { id: string; email: string }) {
  const byEmail = await client.user.findFirst({
    where: { tenantId: home.id, userRole: 'care_admin', email: home.email },
  });
  if (byEmail) return byEmail;
  return client.user.findFirst({
    where: { tenantId: home.id, userRole: 'care_admin' },
    orderBy: { createdAt: 'asc' },
  });
}

async function assertCarehomeFieldsAvailable(options: {
  email?: string;
  phone?: string;
  cqcNumber?: string;
  excludeCarehomeId?: string;
  excludeUserId?: string;
}) {
  const { email, phone, cqcNumber, excludeCarehomeId, excludeUserId } = options;
  const notThisHome = excludeCarehomeId ? { id: { not: excludeCarehomeId } } : {};
  const notThisUser = excludeUserId ? { id: { not: excludeUserId } } : {};

  if (cqcNumber) {
    const owner = await prisma.carehome.findFirst({
      where: { cqcNumber: { equals: cqcNumber, mode: 'insensitive' }, ...notThisHome },
      select: { id: true, name: true },
    });
    if (owner) {
      throw new AppError(
        409,
        `CQC number ${cqcNumber} is already registered to "${owner.name}"`,
        'DUPLICATE_CQC',
        { carehomeId: owner.id, carehomeName: owner.name },
      );
    }
  }

  if (email) {
    const [home, user, admin] = await Promise.all([
      prisma.carehome.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, ...notThisHome },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, ...notThisUser },
        select: { id: true },
      }),
      prisma.adminUser.findUnique({ where: { emailLower: email }, select: { id: true } }),
    ]);
    if (home || user || admin) {
      throw new AppError(409, `The email ${email} is already in use on CarePaddy`, 'DUPLICATE_EMAIL');
    }
  }

  if (phone) {
    const [home, user] = await Promise.all([
      prisma.carehome.findFirst({ where: { phone, ...notThisHome }, select: { id: true } }),
      prisma.user.findFirst({ where: { phone, ...notThisUser }, select: { id: true } }),
    ]);
    if (home || user) {
      throw new AppError(409, `The phone number ${phone} is already in use on CarePaddy`, 'DUPLICATE_PHONE');
    }
  }
}

/** Translate a unique-constraint race (two admins submitting at once) into the error contract. */
function mapUniqueViolation(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const meta = JSON.stringify(err.meta ?? {});
    if (meta.includes('cqcNumber')) {
      throw new AppError(409, 'This CQC number is already registered', 'DUPLICATE_CQC');
    }
    if (meta.includes('phone')) {
      throw new AppError(409, 'This phone number is already in use on CarePaddy', 'DUPLICATE_PHONE');
    }
    if (meta.includes('email')) {
      throw new AppError(409, 'This email is already in use on CarePaddy', 'DUPLICATE_EMAIL');
    }
    throw new AppError(409, 'A care home with these details already exists', 'DUPLICATE');
  }
  throw err;
}

function versionConflict(): AppError {
  return new AppError(409, 'This care home changed since you loaded it. Reload and try again.', 'VERSION_CONFLICT');
}

function invalidTransition(from: CarehomeStatus, action: string, hint?: string): AppError {
  return new AppError(
    409,
    `Cannot ${action} a care home that is ${from.replace(/_/g, ' ')}${hint ? `. ${hint}` : ''}`,
    'INVALID_TRANSITION',
    { currentStatus: from },
  );
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

async function createInviteRecord(
  tx: Tx,
  options: { userId: string; carehomeId: string; email: string; actorId: string },
) {
  await tx.staffInvite.updateMany({
    where: { userId: options.userId, used: false, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });
  return tx.staffInvite.create({
    data: {
      jti: generateJti(),
      userId: options.userId,
      tenantId: options.carehomeId,
      email: options.email,
      invitedById: options.actorId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
}

async function dispatchInvite(
  home: { id: string; name: string },
  invite: { jti: string; userId: string; email: string; expiresAt: Date },
) {
  const token = await signStaffInviteToken(
    { jti: invite.jti, userId: invite.userId, tenantId: home.id, email: invite.email },
    `${INVITE_TTL_DAYS}d`,
  );
  const delivered = await sendCarehomeInviteEmail({
    to: invite.email,
    carehomeName: home.name,
    token,
    expiresAt: invite.expiresAt,
  });
  await prisma.carehome.update({
    where: { id: home.id },
    data: { inviteSendFailedAt: delivered ? null : new Date() },
  });
  return { sentTo: invite.email, expiresAt: invite.expiresAt, delivered };
}

// ---------------------------------------------------------------------------
// US-1 / US-2: list, search, filter
// ---------------------------------------------------------------------------

/** Prisma passes `contains` straight into ILIKE, so LIKE wildcards must be escaped. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function buildSearchWhere(search: string | undefined): Prisma.CarehomeWhereInput {
  const raw = search?.trim();
  if (!raw) return {};
  const term = escapeLike(raw);
  const or: Prisma.CarehomeWhereInput[] = [
    { name: { contains: term, mode: 'insensitive' } },
    { email: { contains: term, mode: 'insensitive' } },
    { cqcNumber: { contains: term, mode: 'insensitive' } },
  ];
  const phoneDigits = raw.replace(/[\s().-]/g, '');
  if (/^\+?\d{3,}$/.test(phoneDigits)) {
    or.push({ phone: { contains: phoneDigits } });
    const asUk = normalizeUkPhone(phoneDigits);
    if (asUk) or.push({ phone: asUk });
    else if (phoneDigits.startsWith('0')) or.push({ phone: { contains: phoneDigits.slice(1) } });
  }
  return { OR: or };
}

export async function listCarehomes(query: ListCarehomesQuery) {
  const now = new Date();
  const searchWhere = buildSearchWhere(query.search);

  const [all, ...perStatus] = await Promise.all([
    prisma.carehome.count({ where: searchWhere }),
    ...CAREHOME_STATUSES.map((status) =>
      prisma.carehome.count({ where: { AND: [searchWhere, carehomeStatusWhere(status, now)] } }),
    ),
  ]);
  const counts = Object.fromEntries([
    ['all', all],
    ...CAREHOME_STATUSES.map((status, i) => [status, perStatus[i]]),
  ]) as Record<'all' | CarehomeStatus, number>;

  const total = counts[query.status];
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, totalPages);

  const where: Prisma.CarehomeWhereInput =
    query.status === 'all' ? searchWhere : { AND: [searchWhere, carehomeStatusWhere(query.status, now)] };

  const rows = await prisma.carehome.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * query.limit,
    take: query.limit,
    include: { _count: { select: { residents: true } } },
  });

  return {
    total,
    page,
    limit: query.limit,
    totalPages,
    counts,
    data: rows.map((home) => {
      const status = computeCarehomeStatus(home, now);
      return {
        id: home.id,
        name: home.name,
        email: home.email,
        cqcNumber: home.cqcNumber,
        phone: home.phone,
        residentsCount: status === 'invited' ? null : home._count.residents,
        status,
        inviteDeliveryFailed: Boolean(home.inviteSendFailedAt),
        createdAt: home.createdAt,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// US-3: create and invite
// ---------------------------------------------------------------------------

export async function createCarehome(input: CreateCarehomeInput, actorId: string) {
  const email = normalizeEmail(input.email);
  const { name, cqcNumber, phone } = input;

  await assertCarehomeFieldsAvailable({ email, phone, cqcNumber });

  const placeholderPassword = await hashPassword(randomUUID());

  let created: { home: Carehome; invite: { jti: string; userId: string; email: string; expiresAt: Date } };
  try {
    created = await prisma.$transaction(async (tx) => {
      const home = await tx.carehome.create({
        data: { name, cqcNumber, email, phone, status: 'pending', invitedById: actorId },
      });
      const user = await tx.user.create({
        data: {
          name,
          email,
          phone,
          password: placeholderPassword,
          userType: 'client',
          userRole: 'care_admin',
          status: 'pending',
          tenantId: home.id,
        },
      });
      const invite = await createInviteRecord(tx, { userId: user.id, carehomeId: home.id, email, actorId });
      await writeAdminAuditLog(
        {
          actorId,
          action: 'carehome.create',
          targetType: TARGET_TYPE,
          targetId: home.id,
          afterState: auditSnapshot(home),
        },
        tx,
      );
      return { home, invite };
    });
  } catch (err) {
    mapUniqueViolation(err);
  }

  const invite = await dispatchInvite(created.home, created.invite);
  await writeAdminAuditLog({
    actorId,
    action: 'carehome.invite.sent',
    targetType: TARGET_TYPE,
    targetId: created.home.id,
    afterState: invite,
  });

  const home = await prisma.carehome.findUniqueOrThrow({ where: { id: created.home.id } });
  return { carehome: serializeCarehome(home), invite };
}

// ---------------------------------------------------------------------------
// US-4: profile and rooms
// ---------------------------------------------------------------------------

export async function getCarehomeProfile(id: string, actorId: string) {
  const home = await loadCarehomeOrThrow(id);
  const now = new Date();
  const status = computeCarehomeStatus(home, now);

  const [residents, totalOrders, openOrders, careAdmin, history] = await Promise.all([
    prisma.resident.count({ where: { tenantId: id } }),
    prisma.storeOrder.count({ where: { carehomeId: id } }),
    prisma.storeOrder.count({ where: { carehomeId: id, status: { in: OPEN_STORE_ORDER_STATUSES } } }),
    findPrimaryCareAdmin(prisma, home),
    prisma.adminAuditLog.findMany({
      where: { targetType: TARGET_TYPE, targetId: id, action: { not: 'carehome.profile.view' } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const adminIds = [home.deactivatedById, home.manuallyInactiveById].filter((v): v is string => Boolean(v));
  const admins = adminIds.length
    ? await prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true } })
    : [];
  const adminName = (adminId: string | null) => admins.find((a) => a.id === adminId) ?? null;

  const latestInvite =
    status === 'invited' && careAdmin
      ? await prisma.staffInvite.findFirst({
          where: { userId: careAdmin.id },
          orderBy: { createdAt: 'desc' },
          select: { expiresAt: true, createdAt: true, used: true },
        })
      : null;

  void writeAdminAuditLog({
    actorId,
    action: 'carehome.profile.view',
    targetType: TARGET_TYPE,
    targetId: id,
  });

  return {
    ...serializeCarehome(home, now),
    readOnly: status === 'deactivated',
    stats: {
      totalOrders,
      openOrders,
      totalResidents: residents,
      totalRooms: residents,
    },
    careAdmin: careAdmin
      ? { id: careAdmin.id, name: careAdmin.name, email: careAdmin.email, phone: careAdmin.phone, status: careAdmin.status }
      : null,
    invite: latestInvite
      ? {
          sentAt: latestInvite.createdAt,
          expiresAt: latestInvite.expiresAt,
          expired: latestInvite.expiresAt <= now,
          deliveryFailed: Boolean(home.inviteSendFailedAt),
        }
      : null,
    deactivation:
      status === 'deactivated'
        ? {
            at: home.deactivatedAt,
            by: adminName(home.deactivatedById),
            reason: home.deactivationReason,
            note: home.deactivationNote,
          }
        : null,
    manualInactive: home.manuallyInactive
      ? { at: home.manuallyInactiveAt, by: adminName(home.manuallyInactiveById), reason: home.manuallyInactiveReason }
      : null,
    history: history.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actor: entry.actor ?? (entry.actorId ? { id: entry.actorId, name: null, email: null } : null),
      source: entry.actorId ? 'admin' : 'system',
      before: entry.beforeState,
      after: entry.afterState,
      createdAt: entry.createdAt,
    })),
  };
}

function roomStatusWhere(status: ListCarehomeRoomsQuery['status'], now: Date): Prisma.ResidentWhereInput {
  const pendingInvite: Prisma.InviteWhereInput = { used: false, expiresAt: { gt: now } };
  switch (status) {
    case 'active':
      return { guardians: { some: { status: 'active' } } };
    case 'invite_sent':
      return { guardians: { none: { status: 'active' } }, invites: { some: pendingInvite } };
    case 'inactive':
      return { guardians: { none: { status: 'active' } }, invites: { none: pendingInvite } };
    default:
      return {};
  }
}

export async function listCarehomeRooms(id: string, query: ListCarehomeRoomsQuery) {
  await loadCarehomeOrThrow(id);
  const now = new Date();
  const term = query.search?.trim() ? escapeLike(query.search.trim()) : undefined;
  const base: Prisma.ResidentWhereInput = {
    tenantId: id,
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { residentNumber: { contains: term, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const tabs = ['all', 'active', 'inactive', 'invite_sent'] as const;
  const tabCounts = await Promise.all(
    tabs.map((tab) => prisma.resident.count({ where: { AND: [base, roomStatusWhere(tab, now)] } })),
  );
  const counts = Object.fromEntries(tabs.map((tab, i) => [tab, tabCounts[i]])) as Record<
    (typeof tabs)[number],
    number
  >;

  const total = counts[query.status];
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, totalPages);

  const rows = await prisma.resident.findMany({
    where: { AND: [base, roomStatusWhere(query.status, now)] },
    orderBy: [{ residentNumber: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * query.limit,
    take: query.limit,
    include: {
      guardians: {
        include: { guardian: { select: { id: true, name: true, email: true, phone: true } } },
      },
      invites: {
        where: { used: false, expiresAt: { gt: now } },
        select: { guardianName: true, email: true, phone: true, expiresAt: true },
      },
      _count: { select: { storeOrders: true } },
    },
  });

  return {
    total,
    page,
    limit: query.limit,
    totalPages,
    counts,
    data: rows.map((resident) => {
      const hasActiveGuardian = resident.guardians.some((g) => g.status === 'active');
      return {
        id: resident.id,
        residentName: resident.name,
        roomNumber: resident.residentNumber,
        status: hasActiveGuardian ? 'active' : resident.invites.length > 0 ? 'invite_sent' : 'inactive',
        guardians: resident.guardians.map((g) => ({
          id: g.guardian.id,
          name: g.guardian.name,
          email: g.guardian.email,
          phone: g.guardian.phone,
          linkStatus: g.status,
        })),
        pendingInvites: resident.invites,
        requestsCount: resident._count.storeOrders,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// US-5: edit
// ---------------------------------------------------------------------------

export async function updateCarehome(id: string, input: UpdateCarehomeInput, actorId: string) {
  if (input.cqcNumber !== undefined) {
    throw new AppError(422, 'The CQC number cannot be changed. Contact support for provider transfers.', 'CQC_IMMUTABLE');
  }

  const before = await loadCarehomeOrThrow(id);
  const status = computeCarehomeStatus(before);
  if (status === 'deactivated') {
    throw new AppError(409, 'Activate this care home before editing it', 'CARE_HOME_DEACTIVATED');
  }
  if (before.version !== input.version) throw versionConflict();

  const name = input.name !== undefined && input.name !== before.name ? input.name : undefined;
  const email =
    input.email !== undefined && normalizeEmail(input.email) !== before.email ? normalizeEmail(input.email) : undefined;
  const phone = input.phone !== undefined && input.phone !== before.phone ? input.phone : undefined;

  if (name === undefined && email === undefined && phone === undefined) {
    throw new AppError(400, 'Nothing to update — the submitted values match the current record', 'NO_CHANGES');
  }

  const careAdmin = await findPrimaryCareAdmin(prisma, before);
  await assertCarehomeFieldsAvailable({ email, phone, excludeCarehomeId: id, excludeUserId: careAdmin?.id });

  let updated: Carehome;
  let newInvite: { jti: string; userId: string; email: string; expiresAt: Date } | null;
  try {
    ({ updated, newInvite } = await prisma.$transaction(async (tx) => {
      let reissued: { jti: string; userId: string; email: string; expiresAt: Date } | null = null;
      const result = await tx.carehome.updateMany({
        where: { id, version: input.version },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(email !== undefined ? { email, isEmailVerified: false } : {}),
          ...(phone !== undefined ? { phone, isPhoneVerified: false } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) throw versionConflict();

      if (careAdmin && (email !== undefined || phone !== undefined)) {
        await tx.user.update({
          where: { id: careAdmin.id },
          data: {
            ...(email !== undefined && careAdmin.email === before.email ? { email } : {}),
            ...(phone !== undefined && careAdmin.phone === before.phone ? { phone } : {}),
          },
        });
      }

      if (email !== undefined && careAdmin) {
        if (status === 'invited') {
          reissued = await createInviteRecord(tx, { userId: careAdmin.id, carehomeId: id, email, actorId });
        } else {
          await tx.session.updateMany({
            where: { userId: careAdmin.id, revoked: false },
            data: { revoked: true },
          });
        }
      }

      const after = await tx.carehome.findUniqueOrThrow({ where: { id } });
      await writeAdminAuditLog(
        {
          actorId,
          action: email !== undefined ? 'carehome.update.email' : 'carehome.update',
          targetType: TARGET_TYPE,
          targetId: id,
          beforeState: auditSnapshot(before),
          afterState: auditSnapshot(after),
        },
        tx,
      );
      return { updated: after, newInvite: reissued };
    }));
  } catch (err) {
    mapUniqueViolation(err);
  }

  let invite: Awaited<ReturnType<typeof dispatchInvite>> | null = null;
  if (newInvite) {
    invite = await dispatchInvite(updated, newInvite);
    await writeAdminAuditLog({
      actorId,
      action: 'carehome.invite.resent',
      targetType: TARGET_TYPE,
      targetId: id,
      afterState: { ...invite, cause: 'email_changed' },
    });
    updated = await prisma.carehome.findUniqueOrThrow({ where: { id } });
  } else if (email !== undefined) {
    void sendCarehomeEmailChangedNotice({ oldEmail: before.email, newEmail: email, carehomeName: updated.name });
  }

  return { carehome: serializeCarehome(updated), invite };
}

// ---------------------------------------------------------------------------
// US-8: resend / cancel invite
// ---------------------------------------------------------------------------

function alreadyActivated(): AppError {
  return new AppError(409, 'This care home has already activated its account', 'ALREADY_ACTIVATED');
}

export async function resendCarehomeInvite(id: string, actorId: string) {
  const home = await loadCarehomeOrThrow(id);
  if (home.status !== 'pending') throw alreadyActivated();

  const careAdmin = await findPrimaryCareAdmin(prisma, home);
  if (!careAdmin || careAdmin.status !== 'pending') throw alreadyActivated();

  const recent = await prisma.staffInvite.count({
    where: { userId: careAdmin.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= INVITE_RESENDS_PER_HOUR) {
    throw new AppError(
      429,
      `Invites can be sent at most ${INVITE_RESENDS_PER_HOUR} times per hour. Try again later.`,
      'RATE_LIMITED',
    );
  }

  const record = await prisma.$transaction((tx) =>
    createInviteRecord(tx, { userId: careAdmin.id, carehomeId: id, email: home.email, actorId }),
  );
  const invite = await dispatchInvite(home, record);
  await writeAdminAuditLog({
    actorId,
    action: 'carehome.invite.resent',
    targetType: TARGET_TYPE,
    targetId: id,
    afterState: invite,
  });
  return invite;
}

/** Never-activated invite records are hard-deleted so the CQC number and email are released. */
export async function cancelCarehomeInvite(id: string, actorId: string) {
  await prisma.$transaction(async (tx) => {
    const home = await lockCarehomeOrThrow(tx, id);
    if (home.status !== 'pending') throw alreadyActivated();

    const [residents, orders, guardianRequests] = await Promise.all([
      tx.resident.count({ where: { tenantId: id } }),
      tx.storeOrder.count({ where: { carehomeId: id } }),
      tx.guardianRegistrationRequest.count({ where: { tenantId: id } }),
    ]);
    if (residents + orders + guardianRequests > 0) {
      throw new AppError(409, 'This care home already has linked data and cannot be removed', 'CARE_HOME_HAS_DATA');
    }

    const users = await tx.user.findMany({ where: { tenantId: id }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    await tx.staffInvite.deleteMany({ where: { tenantId: id } });
    await tx.session.deleteMany({ where: { userId: { in: userIds } } });
    await tx.failedLoginAttempt.deleteMany({ where: { userId: { in: userIds } } });
    await tx.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
    await tx.carehome.delete({ where: { id } });

    await writeAdminAuditLog(
      {
        actorId,
        action: 'carehome.invite.cancelled',
        targetType: TARGET_TYPE,
        targetId: id,
        beforeState: auditSnapshot(home),
      },
      tx,
    );
  });

  return { message: 'Invite cancelled. The CQC number and email can be used again.' };
}

// ---------------------------------------------------------------------------
// US-6 / US-7: deactivate and activate
// ---------------------------------------------------------------------------

export async function deactivateCarehome(id: string, input: DeactivateCarehomeInput, actorId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const home = await lockCarehomeOrThrow(tx, id);
    const status = computeCarehomeStatus(home);
    if (status === 'deactivated') {
      throw new AppError(409, 'This care home is already deactivated', 'ALREADY_DEACTIVATED');
    }
    if (status === 'invited') {
      throw invalidTransition(status, 'deactivate', 'Cancel the invite instead.');
    }

    const [openOrderCount, sample] = await Promise.all([
      tx.storeOrder.count({ where: { carehomeId: id, status: { in: OPEN_STORE_ORDER_STATUSES } } }),
      tx.storeOrder.findMany({
        where: { carehomeId: id, status: { in: OPEN_STORE_ORDER_STATUSES } },
        orderBy: { requestedAt: 'asc' },
        take: OPEN_ORDER_SAMPLE_SIZE,
        select: { id: true, referenceId: true, status: true },
      }),
    ]);
    if (openOrderCount > 0) {
      throw new AppError(
        409,
        `This care home has ${openOrderCount} open order${openOrderCount === 1 ? '' : 's'}. Resolve them in Order Request before deactivating.`,
        'CARE_HOME_HAS_OPEN_ORDERS',
        { openOrderCount, orders: sample },
      );
    }

    const now = new Date();
    const updated = await tx.carehome.update({
      where: { id },
      data: {
        status: 'suspended',
        deactivatedAt: now,
        deactivatedById: actorId,
        deactivationReason: input.reason,
        deactivationNote: input.note || null,
        version: { increment: 1 },
      },
    });

    const sessions = await tx.session.updateMany({
      where: { revoked: false, user: { tenantId: id } },
      data: { revoked: true },
    });
    await tx.staffInvite.updateMany({
      where: { tenantId: id, used: false, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    await tx.invite.updateMany({
      where: { tenantId: id, used: false, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });

    await writeAdminAuditLog(
      {
        actorId,
        action: 'carehome.deactivate',
        targetType: TARGET_TYPE,
        targetId: id,
        beforeState: { status },
        afterState: {
          status: 'deactivated',
          reason: input.reason,
          note: input.note,
          sessionsRevoked: sessions.count,
        },
      },
      tx,
    );
    return updated;
  });

  notifyCarehomeStatusChange(id, 'deactivated');
  return serializeCarehome(result);
}

export async function activateCarehome(id: string, input: ActivateCarehomeInput, actorId: string) {
  const { updated, recheckCqc } = await prisma.$transaction(async (tx) => {
    const home = await lockCarehomeOrThrow(tx, id);
    const status = computeCarehomeStatus(home);
    if (status === 'invited') {
      throw invalidTransition(status, 'activate', 'The care admin must accept the invite.');
    }
    if (status !== 'deactivated') {
      throw new AppError(409, 'This care home is already active', 'ALREADY_ACTIVE', { currentStatus: status });
    }

    const emailTakenByAdmin = await tx.adminUser.findUnique({
      where: { emailLower: home.email },
      select: { id: true },
    });
    if (emailTakenByAdmin) {
      throw new AppError(409, `The email ${home.email} is now used by another account`, 'DUPLICATE_EMAIL');
    }

    const recheckCqc = home.deactivationReason === 'cqc_issue';
    const updated = await tx.carehome.update({
      where: { id },
      data: {
        status: 'active',
        lastActivityAt: new Date(),
        manuallyInactive: false,
        manuallyInactiveAt: null,
        manuallyInactiveById: null,
        manuallyInactiveReason: null,
        deactivatedAt: null,
        deactivatedById: null,
        deactivationReason: null,
        deactivationNote: null,
        ...(recheckCqc ? { cqcCheck: false, cqcCheckedAt: null } : {}),
        version: { increment: 1 },
      },
    });

    await writeAdminAuditLog(
      {
        actorId,
        action: 'carehome.activate',
        targetType: TARGET_TYPE,
        targetId: id,
        beforeState: {
          status,
          deactivatedAt: home.deactivatedAt,
          deactivationReason: home.deactivationReason,
        },
        afterState: { status: computeCarehomeStatus(updated), note: input.note, cqcRecheck: recheckCqc },
      },
      tx,
    );
    return { updated, recheckCqc };
  });

  if (recheckCqc) scheduleCarehomeCqcCheck(id);
  notifyCarehomeStatusChange(id, 'reactivated');
  return serializeCarehome(updated);
}

// ---------------------------------------------------------------------------
// US-9: manual inactive / active
// ---------------------------------------------------------------------------

export async function markCarehomeInactive(id: string, input: MarkCarehomeInactiveInput, actorId: string) {
  const home = await loadCarehomeOrThrow(id);
  const status = computeCarehomeStatus(home);
  if (status === 'inactive') {
    throw new AppError(409, 'This care home is already inactive', 'ALREADY_INACTIVE');
  }
  if (status !== 'active') throw invalidTransition(status, 'mark inactive');

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.carehome.updateMany({
      where: { id, version: home.version },
      data: {
        manuallyInactive: true,
        manuallyInactiveAt: new Date(),
        manuallyInactiveById: actorId,
        manuallyInactiveReason: input.reason,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw versionConflict();
    await writeAdminAuditLog(
      {
        actorId,
        action: 'carehome.mark_inactive',
        targetType: TARGET_TYPE,
        targetId: id,
        beforeState: { status },
        afterState: { status: 'inactive', reason: input.reason, source: 'admin' },
      },
      tx,
    );
    return tx.carehome.findUniqueOrThrow({ where: { id } });
  });

  return serializeCarehome(updated);
}

export async function markCarehomeActive(id: string, input: MarkCarehomeActiveInput, actorId: string) {
  const home = await loadCarehomeOrThrow(id);
  const status = computeCarehomeStatus(home);
  if (status === 'active') {
    throw new AppError(409, 'This care home is already active', 'ALREADY_ACTIVE');
  }
  if (status !== 'inactive') throw invalidTransition(status, 'mark active');

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.carehome.updateMany({
      where: { id, version: home.version },
      data: {
        manuallyInactive: false,
        manuallyInactiveAt: null,
        manuallyInactiveById: null,
        manuallyInactiveReason: null,
        lastActivityAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw versionConflict();
    await writeAdminAuditLog(
      {
        actorId,
        action: 'carehome.mark_active',
        targetType: TARGET_TYPE,
        targetId: id,
        beforeState: { status, manual: home.manuallyInactive },
        afterState: { status: 'active', note: input.note, source: 'admin' },
      },
      tx,
    );
    return tx.carehome.findUniqueOrThrow({ where: { id } });
  });

  return serializeCarehome(updated);
}
