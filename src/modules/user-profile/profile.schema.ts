import { z } from '@docs/zod-extend';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be E.164-ish');

/** Same shape used at carehome registration. */
export const addressSchema = z.object({
  postcode: z.string().trim().min(2).max(20),
  fullAddress: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(100),
});

export const updateUserProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.email().optional(),
    phone: phoneSchema.optional(),
    address: addressSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.email !== undefined ||
      value.phone !== undefined ||
      value.address !== undefined,
    {
      message: 'At least one of name, email, phone, or address is required',
    },
  );

export const updateProfileImageSchema = z.object({
  imageBase64: z.string().min(1),
  contentType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
});

export const changeUserPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

export const disableAccountSchema = z.object({
  confirm: z.literal(true, {
    error: 'You must confirm account deactivation',
  }),
});

export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
export type UpdateProfileImageInput = z.infer<typeof updateProfileImageSchema>;
export type ChangeUserPasswordInput = z.infer<typeof changeUserPasswordSchema>;
export type DisableAccountInput = z.infer<typeof disableAccountSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
