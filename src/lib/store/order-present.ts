import type { Prisma, StoreOrderStatus } from '../../generated/prisma/client.js';

export function presentLineItem(item: {
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

export function presentOrderListItem(order: {
  id: string;
  referenceId: string;
  status: StoreOrderStatus;
  requestedAt: Date;
  total: Prisma.Decimal;
  resident: { id: string; name: string; residentNumber: string };
  carehome: { id: string; name: string };
}) {
  return {
    id: order.id,
    referenceId: order.referenceId,
    status: order.status,
    requestedAt: order.requestedAt,
    total: order.total.toString(),
    resident: order.resident,
    carehome: order.carehome,
  };
}

export function presentOrderDetail(order: {
  id: string;
  referenceId: string;
  status: StoreOrderStatus;
  requestedAt: Date;
  deliveryAddressLine: string;
  deliveryCity: string;
  deliveryPostcode: string;
  itemsSubtotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  carehome: { id: string; name: string };
  resident: { id: string; name: string; residentNumber: string };
  lineItems: Array<{
    id: string;
    productName: string;
    productImageUrl: string | null;
    unitPrice: Prisma.Decimal;
    quantity: number;
  }>;
}) {
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
    items: order.lineItems.map(presentLineItem),
    itemsSubtotal: order.itemsSubtotal.toString(),
    deliveryFee: order.deliveryFee.toString(),
    vatRate: order.vatRate.toString(),
    vatAmount: order.vatAmount.toString(),
    total: order.total.toString(),
  };
}
