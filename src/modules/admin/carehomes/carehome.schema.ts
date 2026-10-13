import { z } from '@docs/zod-extend';
import { CAREHOME_STATUSES } from '@lib/carehome-status';

/** Accepts 07..., 020..., +44..., 0044... (spaces, dashes, brackets allowed). Returns E.164 or null. */
export function normalizeUkPhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s().-]/g, '');
  let national: string;
  if (compact.startsWith('+44')) national = compact.slice(3);
  else if (compact.startsWith('0044')) national = compact.slice(4);
  else if (compact.startsWith('0')) national = compact.slice(1);
  else return null;
  if (national.startsWith('0')) national = national.slice(1);
  if (!/^[1-9]\d{8,9}$/.test(national)) return null;
  return `+44${national}`;
}

/** Name is rendered in emails (HTML) and tables. */
export function sanitizeCarehomeName(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim();
}

const ukPhoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .transform((value, ctx) => {
    const normalized = normalizeUkPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid UK phone number (07..., 020... or +44...)' });
      return z.NEVER;
    }
    return normalized;
  })
  .openapi({ example: '07700 900123' });

const carehomeNameSchema = z
  .string()
  .max(200)
  .transform(sanitizeCarehomeName)
  .pipe(z.string().min(1, 'Care home name is required'));

const cqcNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9-]+$/, 'CQC number may only contain letters, digits and hyphens')
  .transform((v) => v.toUpperCase())
  .openapi({ example: '1-123456789' });

const carehomeEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254))
  .openapi({ example: 'manager@sunnymeadows.co.uk' });

const paging = {
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
};

export const carehomeIdParamSchema = z.object({ id: z.string() });

export const listCarehomesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['all', ...CAREHOME_STATUSES]).optional().default('all'),
  ...paging,
});

export const createCarehomeSchema = z.object({
  name: carehomeNameSchema,
  cqcNumber: cqcNumberSchema,
  email: carehomeEmailSchema,
  phone: ukPhoneSchema,
});

export const updateCarehomeSchema = z
  .object({
    name: carehomeNameSchema.optional(),
    email: carehomeEmailSchema.optional(),
    phone: ukPhoneSchema.optional(),
    /** Present only so the API can reject it with CQC_IMMUTABLE instead of silently stripping it. */
    cqcNumber: z.unknown().optional().openapi({ description: 'Not editable — rejected with 422 CQC_IMMUTABLE' }),
    version: z.number().int().min(0).openapi({ description: 'Version from the last read (optimistic locking)' }),
  })
  .refine(
    (v) => v.cqcNumber !== undefined || v.name !== undefined || v.email !== undefined || v.phone !== undefined,
    { message: 'Provide at least one of name, email or phone' },
  );

export const DEACTIVATION_REASONS = ['non_payment', 'cqc_issue', 'closure', 'abuse', 'other'] as const;

export const deactivateCarehomeSchema = z.object({
  reason: z.enum(DEACTIVATION_REASONS),
  note: z.string().trim().max(2000).optional(),
});

export const activateCarehomeSchema = z.object({
  note: z.string().trim().min(1, 'A note is required').max(2000),
});

export const markCarehomeInactiveSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(1000),
});

export const markCarehomeActiveSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

export const ROOM_STATUSES = ['active', 'inactive', 'invite_sent'] as const;

export const listCarehomeRoomsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['all', ...ROOM_STATUSES]).optional().default('all'),
  ...paging,
});

export type ListCarehomesQuery = z.infer<typeof listCarehomesQuerySchema>;
export type CreateCarehomeInput = z.infer<typeof createCarehomeSchema>;
export type UpdateCarehomeInput = z.infer<typeof updateCarehomeSchema>;
export type DeactivateCarehomeInput = z.infer<typeof deactivateCarehomeSchema>;
export type ActivateCarehomeInput = z.infer<typeof activateCarehomeSchema>;
export type MarkCarehomeInactiveInput = z.infer<typeof markCarehomeInactiveSchema>;
export type MarkCarehomeActiveInput = z.infer<typeof markCarehomeActiveSchema>;
export type ListCarehomeRoomsQuery = z.infer<typeof listCarehomeRoomsQuerySchema>;
