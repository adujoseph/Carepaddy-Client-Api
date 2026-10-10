import * as XLSX from 'xlsx';
import {
  assertProductDescription,
  parseProductPrice,
  parseStockQuantity,
} from './validators.js';

export type BulkProductRow = {
  name: string;
  description: string;
  price: string;
  stockQuantity: number;
};

export type BulkRowError = {
  row: number;
  reason: string;
};

export type BulkParseResult = {
  valid: BulkProductRow[];
  errors: BulkRowError[];
};

const MAX_BULK_BYTES = 5 * 1024 * 1024;

const HEADER_ALIASES: Record<string, keyof BulkProductRow> = {
  name: 'name',
  'item name': 'name',
  description: 'description',
  price: 'price',
  'stock quantity': 'stockQuantity',
  stock: 'stockQuantity',
  quantity: 'stockQuantity',
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

function parseRowRecord(
  row: Record<string, unknown>,
  rowNumber: number,
): { ok: BulkProductRow } | { err: BulkRowError } {
  try {
    const name = String(row.name ?? '').trim();
    if (!name) {
      return { err: { row: rowNumber, reason: 'Name is required' } };
    }
    const description = assertProductDescription(String(row.description ?? ''));
    const price = parseProductPrice(String(row.price ?? ''));
    const stockRaw = row.stockQuantity ?? row.stock ?? '';
    const stockQuantity = parseStockQuantity(
      typeof stockRaw === 'number' || typeof stockRaw === 'string' ? stockRaw : String(stockRaw),
    );
    return { ok: { name, description, price, stockQuantity } };
  } catch (e) {
    const message =
      e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
        ? e.message
        : 'Invalid row';
    return { err: { row: rowNumber, reason: message } };
  }
}

function mapRawRows(rows: Record<string, unknown>[]): BulkParseResult {
  const valid: BulkProductRow[] = [];
  const errors: BulkRowError[] = [];

  rows.forEach((raw, index) => {
    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const field = HEADER_ALIASES[normalizeHeader(key)];
      if (field) {
        mapped[field] = value;
      }
    }
    const rowNumber = index + 2;
    const result = parseRowRecord(mapped, rowNumber);
    if ('ok' in result) {
      valid.push(result.ok);
    } else {
      errors.push(result.err);
    }
  });

  return { valid, errors };
}

export function parseBulkProductCsv(text: string): BulkParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { valid: [], errors: [{ row: 1, reason: 'File must include a header row and at least one data row' }] };
  }

  const header = lines[0]!.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const record: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      record[h] = cols[idx] ?? '';
    });
    rows.push(record);
  }

  return mapRawRows(rows);
}

export function parseBulkProductFile(buffer: Buffer, fileName: string): BulkParseResult {
  if (buffer.byteLength > MAX_BULK_BYTES) {
    return { valid: [], errors: [{ row: 0, reason: 'File must be 5MB or smaller' }] };
  }

  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    return parseBulkProductCsv(buffer.toString('utf8'));
  }

  if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]!];
    if (!sheet) {
      return { valid: [], errors: [{ row: 0, reason: 'Spreadsheet has no sheets' }] };
    }
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    return mapRawRows(json);
  }

  return { valid: [], errors: [{ row: 0, reason: 'File must be .csv, .xls, or .xlsx' }] };
}

export const BULK_PRODUCT_TEMPLATE_CSV =
  'name,description,price,stock quantity\nExample item,Short product description here,9.99,100\n';
