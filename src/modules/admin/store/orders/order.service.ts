import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import { writeAdminAuditLog } from '../../audit.service.js';
import type { ListStoreOrdersQuery } from './order.schema.js';
import { Prisma, StoreOrderStatus } from '../../../../generated/prisma/client.js';

const STATUS_LABEL: Record<StoreOrderStatus, string> = {
  NEW: 'Pending Review',
  DECLINED: 'Rejected',
  PENDING_DELIVERY: 'Pending Delivery',
  IN_PROGRESS: 'On the Way',
  DELIVERED: 'Delivered',
};

const STATUS_FILTER_MAP: Record<
  Exclude<ListStoreOrdersQuery['status'], undefined>,
  StoreOrderStatus | null
> = {
  all: null,
  pending_review: StoreOrderStatus.NEW,
  rejected: StoreOrderStatus.DECLINED,
  pending_delivery: StoreOrderStatus.PENDING_DELIVERY,
  on_the_way: StoreOrderStatus.IN_PROGRESS,
  delivered: StoreOrderStatus.DELIVERED,
};

function statusFields(status: StoreOrderStatus) {
  return { status, statusLabel: STATUS_LABEL[status] };
}

/** First active guardian with a phone; family contact is blank when nobody has one. */
function familyContactPhone(
  guardians: { status: string; guardian: { phone: string | null } }[] | undefined,
): string | null {
  const active = guardians?.filter((link) => link.status === 'active') ?? [];
  return active.find((link) => link.guardian.phone)?.guardian.phone ?? null;
}

function serializeLineItem(item: {
  id: string;
  productName: string;
  productImageUrl: string | null;
  unitPrice: Prisma.Decimal;
  quantity: number;
}) {
  return {
    id: item.id,
    name: item.productName,
    imageUrl: item.productImageUrl,
    unitPrice: item.unitPrice.toString(),
    quantity: item.quantity,
    lineTotal: (Number(item.unitPrice) * item.quantity).toFixed(2),
  };
}

function serializeOrderSummary(order: {
  id: string;
  referenceId: string;
  status: StoreOrderStatus;
  requestedAt: Date;
  total: Prisma.Decimal;
  carehome: { id: string; name: string };
  resident?: { id: string; name: string; residentNumber: string };
}) {
  return {
    id: order.id,
    referenceId: order.referenceId,
    status: order.status,
    requestedAt: order.requestedAt,
    total: order.total.toString(),
    carehome: order.carehome,
    ...(order.resident ? { resident: order.resident } : {}),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function buildSearchWhere(search: string | undefined): Prisma.StoreOrderWhereInput {
  const raw = search?.trim().replace(/^#/, '');
  if (!raw) return {};
  const q = escapeLike(raw);
  return {
    OR: [
      { referenceId: { contains: q, mode: 'insensitive' } },
      { carehome: { name: { contains: q, mode: 'insensitive' } } },
    ],
  };
}

/** Inclusive UTC day bounds for the date filter. */
function dateRangeWhere(from: string | undefined, to: string | undefined): Prisma.StoreOrderWhereInput {
  if (!from && !to) return {};
  return {
    requestedAt: {
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lt: new Date(Date.parse(`${to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000) } : {}),
    },
  };
}

export async function getStoreOrderStats() {
  const [total, grouped] = await Promise.all([
    prisma.storeOrder.count(),
    prisma.storeOrder.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  const counts: Record<string, number> = {
    total,
    NEW: 0,
    DECLINED: 0,
    PENDING_DELIVERY: 0,
    IN_PROGRESS: 0,
    DELIVERED: 0,
  };

  for (const row of grouped) {
    counts[row.status] = row._count._all;
  }

  return {
    totalOrders: total,
    awaitingFamilyReview: counts.NEW,
    rejected: counts.DECLINED,
    delivered: counts.DELIVERED,
    onTheWay: counts.IN_PROGRESS,
    pendingDelivery: counts.PENDING_DELIVERY,
  };
}

const residentWithFamily = {
  select: {
    id: true,
    name: true,
    residentNumber: true,
    guardians: {
      where: { status: 'active' as const },
      orderBy: { createdAt: 'asc' as const },
      select: { status: true, guardian: { select: { phone: true, name: true } } },
    },
  },
};

export async function listStoreOrders(query: ListStoreOrdersQuery) {
  const statusFilter = STATUS_FILTER_MAP[query.status];
  const where: Prisma.StoreOrderWhereInput = {
    AND: [
      buildSearchWhere(query.search),
      dateRangeWhere(query.from, query.to),
      ...(statusFilter ? [{ status: statusFilter }] : []),
    ],
  };

  const total = await prisma.storeOrder.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const page = Math.min(query.page, totalPages);

  const rows = await prisma.storeOrder.findMany({
    where,
    skip: (page - 1) * query.limit,
    take: query.limit,
    orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
    include: {
      carehome: { select: { id: true, name: true } },
      resident: residentWithFamily,
      lineItems: { select: { quantity: true } },
    },
  });

  return {
    total,
    page,
    limit: query.limit,
    totalPages,
    data: rows.map((order) => ({
      id: order.id,
      orderId: order.referenceId,
      carehome: order.carehome,
      familyContact: familyContactPhone(order.resident.guardians),
      itemCount: order.lineItems.reduce((sum, line) => sum + line.quantity, 0),
      date: order.requestedAt,
      ...statusFields(order.status),
    })),
  };
}

export async function getStoreOrder(id: string) {
  const order = await prisma.storeOrder.findUnique({
    where: { id },
    include: {
      carehome: { select: { id: true, name: true, addressLine: true, city: true, postcode: true } },
      resident: residentWithFamily,
      lineItems: true,
    },
  });

  if (!order) {
    throw new AppError(404, 'Order not found', 'NOT_FOUND');
  }

  const itemCount = order.lineItems.reduce((sum, line) => sum + line.quantity, 0);

  return {
    id: order.id,
    orderId: order.referenceId,
    ...statusFields(order.status),
    requestDate: order.requestedAt,
    familyContact: familyContactPhone(order.resident.guardians),
    carehome: order.carehome,
    resident: { id: order.resident.id, name: order.resident.name, residentNumber: order.resident.residentNumber },
    deliveryAddress: {
      addressLine: order.deliveryAddressLine,
      city: order.deliveryCity,
      postcode: order.deliveryPostcode,
    },
    itemCount,
    items: order.lineItems.map(serializeLineItem),
    itemsPrice: order.itemsSubtotal.toString(),
    deliveryFee: order.deliveryFee.toString(),
    vatPercent: (Number(order.vatRate) * 100).toString(),
    vatAmount: order.vatAmount.toString(),
    totalPrice: order.total.toString(),
  };
}

export async function getStoreOrderStatusHistory(orderId: string) {
  const order = await prisma.storeOrder.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) {
    throw new AppError(404, 'Order not found', 'NOT_FOUND');
  }

  const rows = await prisma.storeOrderStatusHistory.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
    include: {
      adminUser: { select: { id: true, name: true, email: true } },
    },
  });

  return {
    data: rows.map((row) => ({
      id: row.id,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actorKind: row.actorKind,
      admin: row.adminUser,
      clientUserId: row.clientUserId,
      note: row.note,
      createdAt: row.createdAt,
    })),
  };
}

export async function sendStoreOrderForDelivery(orderId: string, actorId: string) {
  const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new AppError(404, 'Order not found', 'NOT_FOUND');
  }

  if (order.status !== StoreOrderStatus.PENDING_DELIVERY) {
    throw new AppError(
      409,
      'Order can only be sent for delivery when status is Pending Delivery (Approved)',
      'INVALID_ORDER_STATUS',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.storeOrder.update({
      where: { id: orderId },
      data: { status: StoreOrderStatus.IN_PROGRESS },
      include: { carehome: { select: { id: true, name: true } } },
    });

    await tx.storeOrderStatusHistory.create({
      data: {
        orderId,
        fromStatus: StoreOrderStatus.PENDING_DELIVERY,
        toStatus: StoreOrderStatus.IN_PROGRESS,
        actorKind: 'ADMIN',
        adminUserId: actorId,
        note: 'Send out for delivery',
      },
    });

    return next;
  });

  await writeAdminAuditLog({
    actorId,
    action: 'store.order.send_for_delivery',
    targetType: 'StoreOrder',
    targetId: orderId,
    beforeState: { status: order.status },
    afterState: { status: updated.status },
  });

  return serializeOrderSummary(updated);
}
