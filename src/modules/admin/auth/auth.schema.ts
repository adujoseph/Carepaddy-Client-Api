import { z } from '@docs/zod-extend';

export const adminLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
  captchaToken: z.string().min(1).optional(),
});

export const adminForgotPasswordSchema = z.object({
  email: z.email(),
});

export const adminResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12).max(200),
});

export const adminChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

export const verifyAdminInviteQuerySchema = z.object({
  token: z.string().min(1),
});

export const acceptAdminInviteSchema = z.object({
  inviteToken: z.string().min(1),
  password: z.string().min(12).max(200),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminForgotPasswordInput = z.infer<typeof adminForgotPasswordSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
export type AdminChangePasswordInput = z.infer<typeof adminChangePasswordSchema>;
export type AcceptAdminInviteInput = z.infer<typeof acceptAdminInviteSchema>;
