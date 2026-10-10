import { AppError } from '@middleware/error-handler';

export const MAX_PRODUCT_DESCRIPTION_WORDS = 200;

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function assertProductDescription(description: string) {
  const trimmed = description.trim();
  if (!trimmed) {
    throw new AppError(400, 'Description is required', 'VALIDATION_ERROR');
  }
  if (countWords(trimmed) > MAX_PRODUCT_DESCRIPTION_WORDS) {
    throw new AppError(
      400,
      `Description must be at most ${MAX_PRODUCT_DESCRIPTION_WORDS} words`,
      'VALIDATION_ERROR',
    );
  }
  return trimmed;
}

/** GBP price: positive, up to two decimal places. */
export function parseProductPrice(value: string | number): string {
  const raw = typeof value === 'number' ? value.toFixed(2) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new AppError(400, 'Price must be a positive GBP amount with up to two decimal places', 'VALIDATION_ERROR');
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AppError(400, 'Price must be greater than zero', 'VALIDATION_ERROR');
  }
  return n.toFixed(2);
}

export function parseStockQuantity(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new AppError(400, 'Stock quantity must be a non-negative integer', 'VALIDATION_ERROR');
  }
  return n;
}
