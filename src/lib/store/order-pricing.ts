import { randomBytes } from 'node:crypto';

/** Mockup default VAT (7.5%) — override via env when configurable. */
export const DEFAULT_STORE_VAT_RATE = Number(
  process.env.STORE_VAT_RATE ?? '0.075',
);

export const DEFAULT_STORE_DELIVERY_FEE = Number(
  process.env.STORE_DELIVERY_FEE_GBP ?? '0',
);

export function generateStoreOrderReferenceId(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${stamp}-${suffix}`;
}

export function calculateOrderTotals(itemsSubtotal: number) {
  const deliveryFee = DEFAULT_STORE_DELIVERY_FEE;
  const vatRate = DEFAULT_STORE_VAT_RATE;
  const taxable = itemsSubtotal + deliveryFee;
  const vatAmount = Math.round(taxable * vatRate * 100) / 100;
  const total = Math.round((taxable + vatAmount) * 100) / 100;

  return {
    deliveryFee: deliveryFee.toFixed(2),
    vatRate: vatRate.toFixed(4),
    vatAmount: vatAmount.toFixed(2),
    total: total.toFixed(2),
    itemsSubtotal: itemsSubtotal.toFixed(2),
  };
}

export function money(n: number): string {
  return n.toFixed(2);
}
