import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '@config/env';
import { AppError } from '@middleware/error-handler';

const ALLOWED_CONTENT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
]);

const MAX_IMAGE_BYTES = 1024 * 1024;

export function decodeProductImageBase64(imageBase64: string): Buffer {
  const raw = imageBase64.includes(',')
    ? imageBase64.slice(imageBase64.indexOf(',') + 1)
    : imageBase64;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw new AppError(400, 'Invalid image data', 'INVALID_IMAGE');
  }

  if (buffer.byteLength === 0) {
    throw new AppError(400, 'Invalid image data', 'INVALID_IMAGE');
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError(400, 'Product image must be 1MB or smaller', 'IMAGE_TOO_LARGE');
  }

  return buffer;
}

function resolveImageExtension(contentType: string): string {
  const ext = ALLOWED_CONTENT_TYPES.get(contentType.toLowerCase());
  if (!ext) {
    throw new AppError(400, 'Only JPG and PNG images are supported', 'UNSUPPORTED_IMAGE_TYPE');
  }
  return ext;
}

export async function storeProductImage(options: {
  productId: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string> {
  const ext = resolveImageExtension(options.contentType);
  const key = `store/products/${options.productId}/${randomUUID()}.${ext}`;
  const uploadsRoot = path.resolve(process.cwd(), 'uploads');
  const filePath = path.join(uploadsRoot, key);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, options.buffer);

  return `${env.apiPublicUrl.replace(/\/$/, '')}/uploads/${key}`;
}
