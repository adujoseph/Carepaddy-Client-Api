import { prisma } from '@lib/prisma';
import { logger } from '@lib/logger';
import type { AccountStatus, Prisma, StoreOrderStatus } from '../generated/prisma/client.js';

export const CAREHOME_INACTIVITY_DAYS = 180;
const ACTIVITY_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** Orders in these states block deactivation. DELIVERED and DECLINED are terminal. */
export const OPEN_STORE_ORDER_STATUSES: StoreOrderStatus[] = ['NEW', 'PENDING_DELIVERY', 'IN_PROGRESS'];

export const CAREHOME_STATUSES = [
  'invited',
  'cqc_not_verified',
  'active',
  'inactive',
  'deactivated',
] as const;
export type CarehomeStatus = (typeof CAREHOME_STATUSES)[number];

export function inactivityCutoff(now = new Date()): Date {
  return new Date(now.getTime() - CAREHOME_INACTIVITY_DAYS * 24 * 60 * 60 * 1000);
}

export function computeCarehomeStatus(
  home: {
    status: AccountStatus;
    cqcCheck: boolean;
    manuallyInactive: boolean;
    lastActivityAt: Date | null;
    activatedAt: Date | null;
    createdAt: Date;
  },
  now = new Date(),
): CarehomeStatus {
  if (home.status === 'suspended' || home.status === 'rejected') return 'deactivated';
  if (home.status === 'pending') return 'invited';
  if (!home.cqcCheck) return 'cqc_not_verified';
  if (home.manuallyInactive) return 'inactive';
  const lastActivity = home.lastActivityAt ?? home.activatedAt ?? home.createdAt;
  return lastActivity < inactivityCutoff(now) ? 'inactive' : 'active';
}

/** Prisma filter equivalent of computeCarehomeStatus, so list tabs and counters agree with it. */
export function carehomeStatusWhere(status: CarehomeStatus, now = new Date()): Prisma.CarehomeWhereInput {
  const cutoff = inactivityCutoff(now);
  switch (status) {
    case 'deactivated':
      return { status: { in: ['suspended', 'rejected'] } };
    case 'invited':
      return { status: 'pending' };
    case 'cqc_not_verified':
      return { status: 'active', cqcCheck: false };
    case 'inactive':
      return {
        status: 'active',
        cqcCheck: true,
        OR: [{ manuallyInactive: true }, { lastActivityAt: { lt: cutoff } }],
      };
    case 'active':
      return {
        status: 'active',
        cqcCheck: true,
        manuallyInactive: false,
        OR: [{ lastActivityAt: { gte: cutoff } }, { lastActivityAt: null }],
      };
  }
}

/**
 * Single code path for "care home activity" (care staff login, order placed, resident added).
 * Throttled to one write per hour per home.
 */
export async function touchCarehomeActivity(carehomeId: string | null | undefined): Promise<void> {
  if (!carehomeId) return;
  const now = new Date();
  try {
    await prisma.carehome.updateMany({
      where: {
        id: carehomeId,
        status: 'active',
        OR: [
          { lastActivityAt: null },
          { lastActivityAt: { lt: new Date(now.getTime() - ACTIVITY_TOUCH_INTERVAL_MS) } },
        ],
      },
      data: { lastActivityAt: now },
    });
  } catch (err) {
    logger.warn({ err, carehomeId }, 'carehome activity touch failed');
  }
}

export async function isCarehomeDeactivated(carehomeId: string): Promise<boolean> {
  const home = await prisma.carehome.findUnique({ where: { id: carehomeId }, select: { status: true } });
  return home?.status === 'suspended' || home?.status === 'rejected';
}
