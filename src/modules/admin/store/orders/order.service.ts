import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import { writeAdminAuditLog } from '../../audit.service.js';
import type { ListStoreOrdersQuery } from './order.schema.js';
import { Prisma, StoreOrderStatus } from '../../../../generated/prisma/client.js';

const STATUS_FILTER_MAP: Record<
  Exclude<ListStoreOrdersQuery['status'], undefined>,
  StoreOrderStatus | null
> = {
  all: null,
  new: StoreOrderStatus.NEW,
  declined: StoreOrderStatus.DECLINED,
  pending_delivery: StoreOrderStatus.PENDING_DELIVERY,
  in_progress: StoreOrderStatus.IN_PROGRESS,
  delivered: StoreOrderStatus.DELIVERED,
};

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

function buildSearchWhere(search: string | undefined): Prisma.StoreOrderWhereInput {
  if (!search?.trim()) return {};
  const q = search.trim();
  return {
    OR: [
      { referenceId: { contains: q, mode: 'insensitive' } },
      { carehome: { name: { contains: q, mode: 'insensitive' } } },
    ],
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
    total,
    new: counts.NEW,
    declined: counts.DECLINED,
    pendingDelivery: counts.PENDING_DELIVERY,
    inProgress: counts.IN_PROGRESS,
    delivered: counts.DELIVERED,
  };
}

export async function listStoreOrders(query: ListStoreOrdersQuery) {
  const skip = (query.page - 1) * query.limit;
  const statusFilter = STATUS_FILTER_MAP[query.status];

  const where: Prisma.StoreOrderWhereInput = {
    ...buildSearchWhere(query.search),
    ...(statusFilter ? { status: statusFilter } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.storeOrder.count({ where }),
    prisma.storeOrder.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { requestedAt: 'desc' },
      include: {
        carehome: { select: { id: true, name: true } },
        resident: { select: { id: true, name: true, residentNumber: true } },
      },
    }),
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    data: rows.map(serializeOrderSummary),
  };
}

export async function getStoreOrder(id: string) {
  const order = await prisma.storeOrder.findUnique({
    where: { id },
    include: {
      carehome: { select: { id: true, name: true, addressLine: true, city: true, postcode: true } },
      resident: { select: { id: true, name: true, residentNumber: true } },
      lineItems: true,
    },
  });

  if (!order) {
    throw new AppError(404, 'Order not found', 'NOT_FOUND');
  }

  return {
    id: order.id,
    referenceId: order.referenceId,
    status: order.status,
    requestedAt: order.requestedAt,
    carehome: order.carehome,
    resident: order.resident,
    deliveryAddress: {
      addressLine: order.deliveryAddressLine,
      city: order.deliveryCity,
      postcode: order.deliveryPostcode,
    },
    items: order.lineItems.map(serializeLineItem),
    itemsSubtotal: order.itemsSubtotal.toString(),
    deliveryFee: order.deliveryFee.toString(),
    vatRate: order.vatRate.toString(),
    vatAmount: order.vatAmount.toString(),
    total: order.total.toString(),
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
