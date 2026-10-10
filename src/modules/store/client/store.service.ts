import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';
import {
  assertCarehomeStaffCanAccessOrder,
  assertCarehomeStaffTenant,
  assertGuardianCanAccessOrder,
  assertResidentInCarehome,
} from '@lib/store/order-access.js';
import {
  calculateOrderTotals,
  generateStoreOrderReferenceId,
} from '@lib/store/order-pricing.js';
import { presentOrderDetail, presentOrderListItem } from '@lib/store/order-present.js';
import type {
  CreateStoreOrderInput,
  GuardianOrderDecisionInput,
  ListClientOrdersQuery,
  ListClientProductsQuery,
} from './store.schema.js';
import { Prisma, StoreOrderStatus } from '../../../generated/prisma/client.js';

const CLIENT_STATUS_MAP: Record<
  Exclude<ListClientOrdersQuery['status'], undefined>,
  StoreOrderStatus | null
> = {
  all: null,
  new: StoreOrderStatus.NEW,
  declined: StoreOrderStatus.DECLINED,
  pending_delivery: StoreOrderStatus.PENDING_DELIVERY,
  in_progress: StoreOrderStatus.IN_PROGRESS,
  delivered: StoreOrderStatus.DELIVERED,
};

export async function listStoreProductsForClient(query: ListClientProductsQuery) {
  const skip = (query.page - 1) * query.limit;
  const search = query.search?.trim();

  const where = {
    archivedAt: null,
    stockQuantity: { gt: 0 },
    ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.storeProduct.count({ where }),
    prisma.storeProduct.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    data: rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price.toString(),
      stockQuantity: p.stockQuantity,
      imageUrl: p.imageUrl,
      outOfStock: false,
    })),
  };
}

export async function createStoreOrder(
  input: CreateStoreOrderInput,
  actor: { userId: string; tenantId: string | null | undefined },
) {
  const carehomeId = await assertCarehomeStaffTenant(actor.tenantId);
  await assertResidentInCarehome(input.residentId, carehomeId);

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await prisma.storeProduct.findMany({
    where: {
      id: { in: productIds },
      archivedAt: null,
    },
  });

  if (products.length !== productIds.length) {
    throw new AppError(400, 'One or more products are unavailable', 'INVALID_PRODUCT');
  }

  const productMap = new Map(products.map((p) => [p.id, p]));

  let subtotal = 0;
  const lineData: Array<{
    productId: string;
    productName: string;
    productImageUrl: string | null;
    unitPrice: string;
    quantity: number;
  }> = [];

  for (const item of input.items) {
    const product = productMap.get(item.productId)!;
    const unitPrice = product.price.toString();
    subtotal += Number(product.price) * item.quantity;
    lineData.push({
      productId: product.id,
      productName: product.name,
      productImageUrl: product.imageUrl,
      unitPrice,
      quantity: item.quantity,
    });
  }

  const totals = calculateOrderTotals(subtotal);
  const referenceId = generateStoreOrderReferenceId();

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.storeOrder.create({
      data: {
        referenceId,
        carehomeId,
        residentId: input.residentId,
        createdByUserId: actor.userId,
        status: StoreOrderStatus.NEW,
        deliveryAddressLine: input.deliveryAddressLine.trim(),
        deliveryCity: input.deliveryCity.trim(),
        deliveryPostcode: input.deliveryPostcode.trim(),
        itemsSubtotal: totals.itemsSubtotal,
        deliveryFee: totals.deliveryFee,
        vatRate: totals.vatRate,
        vatAmount: totals.vatAmount,
        total: totals.total,
        lineItems: {
          create: lineData.map((line) => ({
            productId: line.productId,
            productName: line.productName,
            productImageUrl: line.productImageUrl,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
          })),
        },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: StoreOrderStatus.NEW,
            actorKind: 'CLIENT',
            clientUserId: actor.userId,
            note: 'Order created',
          },
        },
      },
      include: {
        carehome: { select: { id: true, name: true } },
        resident: { select: { id: true, name: true, residentNumber: true } },
        lineItems: true,
      },
    });
    return created;
  });

  return presentOrderDetail(order);
}

export async function listCarehomeStoreOrders(
  query: ListClientOrdersQuery,
  tenantId: string | null | undefined,
) {
  const carehomeId = await assertCarehomeStaffTenant(tenantId);
  const skip = (query.page - 1) * query.limit;
  const statusFilter = CLIENT_STATUS_MAP[query.status];

  const where: Prisma.StoreOrderWhereInput = {
    carehomeId,
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
    data: rows.map(presentOrderListItem),
  };
}

export async function listGuardianStoreOrders(
  query: ListClientOrdersQuery,
  guardianId: string,
) {
  const links = await prisma.guardianResident.findMany({
    where: { guardianId, status: 'active' },
    select: { residentId: true },
  });

  const residentIds = links.map((l) => l.residentId);
  if (residentIds.length === 0) {
    return { total: 0, page: query.page, limit: query.limit, data: [] };
  }

  const skip = (query.page - 1) * query.limit;
  const statusFilter = CLIENT_STATUS_MAP[query.status];

  const where: Prisma.StoreOrderWhereInput = {
    residentId: { in: residentIds },
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
    data: rows.map(presentOrderListItem),
  };
}

async function loadOrderDetail(orderId: string) {
  const order = await prisma.storeOrder.findUnique({
    where: { id: orderId },
    include: {
      carehome: { select: { id: true, name: true } },
      resident: { select: { id: true, name: true, residentNumber: true } },
      lineItems: true,
    },
  });
  if (!order) {
    throw new AppError(404, 'Order not found', 'NOT_FOUND');
  }
  return order;
}

export async function getCarehomeStoreOrder(orderId: string, tenantId: string | null | undefined) {
  const carehomeId = await assertCarehomeStaffTenant(tenantId);
  const order = await loadOrderDetail(orderId);
  await assertCarehomeStaffCanAccessOrder(carehomeId, order);
  return presentOrderDetail(order);
}

export async function getGuardianStoreOrder(orderId: string, guardianId: string) {
  const order = await loadOrderDetail(orderId);
  await assertGuardianCanAccessOrder(guardianId, order);
  return presentOrderDetail(order);
}

export async function guardianDecideStoreOrder(
  orderId: string,
  guardianId: string,
  input: GuardianOrderDecisionInput,
) {
  const order = await prisma.storeOrder.findUnique({
    where: { id: orderId },
    include: { lineItems: true },
  });

  if (!order) {
    throw new AppError(404, 'Order not found', 'NOT_FOUND');
  }

  await assertGuardianCanAccessOrder(guardianId, order);

  if (order.status !== StoreOrderStatus.NEW) {
    throw new AppError(409, 'This order is no longer awaiting a decision', 'INVALID_ORDER_STATUS');
  }

  if (!input.approved) {
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.storeOrder.update({
        where: { id: orderId },
        data: { status: StoreOrderStatus.DECLINED },
        include: {
          carehome: { select: { id: true, name: true } },
          resident: { select: { id: true, name: true, residentNumber: true } },
          lineItems: true,
        },
      });
      await tx.storeOrderStatusHistory.create({
        data: {
          orderId,
          fromStatus: StoreOrderStatus.NEW,
          toStatus: StoreOrderStatus.DECLINED,
          actorKind: 'CLIENT',
          clientUserId: guardianId,
          note: input.declineReason?.trim() ?? 'Declined by guardian',
        },
      });
      return next;
    });
    return presentOrderDetail(updated);
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (const item of order.lineItems) {
      const result = await tx.storeProduct.updateMany({
        where: {
          id: item.productId,
          archivedAt: null,
          stockQuantity: { gte: item.quantity },
        },
        data: { stockQuantity: { decrement: item.quantity } },
      });
      if (result.count !== 1) {
        const product = await tx.storeProduct.findUnique({ where: { id: item.productId } });
        throw new AppError(
          409,
          `Insufficient stock to approve order for "${product?.name ?? item.productName}"`,
          'INSUFFICIENT_STOCK_AT_APPROVAL',
        );
      }
    }

    const next = await tx.storeOrder.update({
      where: { id: orderId },
      data: { status: StoreOrderStatus.PENDING_DELIVERY },
      include: {
        carehome: { select: { id: true, name: true } },
        resident: { select: { id: true, name: true, residentNumber: true } },
        lineItems: true,
      },
    });

    await tx.storeOrderStatusHistory.create({
      data: {
        orderId,
        fromStatus: StoreOrderStatus.NEW,
        toStatus: StoreOrderStatus.PENDING_DELIVERY,
        actorKind: 'CLIENT',
        clientUserId: guardianId,
        note: 'Approved by guardian',
      },
    });

    return next;
  });

  return presentOrderDetail(updated);
}

/** Care home admin confirms receipt after platform dispatch (IN_PROGRESS → DELIVERED). */
export async function confirmStoreOrderDelivered(
  orderId: string,
  actor: { userId: string; tenantId: string | null | undefined },
) {
  const carehomeId = await assertCarehomeStaffTenant(actor.tenantId);

  const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new AppError(404, 'Order not found', 'NOT_FOUND');
  }

  await assertCarehomeStaffCanAccessOrder(carehomeId, order);

  if (order.status !== StoreOrderStatus.IN_PROGRESS) {
    throw new AppError(
      409,
      'Order can only be marked delivered when status is On the Way (In Progress)',
      'INVALID_ORDER_STATUS',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.storeOrder.update({
      where: { id: orderId },
      data: { status: StoreOrderStatus.DELIVERED },
      include: {
        carehome: { select: { id: true, name: true } },
        resident: { select: { id: true, name: true, residentNumber: true } },
        lineItems: true,
      },
    });

    await tx.storeOrderStatusHistory.create({
      data: {
        orderId,
        fromStatus: StoreOrderStatus.IN_PROGRESS,
        toStatus: StoreOrderStatus.DELIVERED,
        actorKind: 'CLIENT',
        clientUserId: actor.userId,
        note: 'Delivery confirmed by care home admin',
      },
    });

    return next;
  });

  return presentOrderDetail(updated);
}
