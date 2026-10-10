import { z } from '@docs/zod-extend';

export const mfaEnrollStartSchema = z.object({
  currentPassword: z.string().min(1).max(200),
});

export const mfaEnrollConfirmSchema = z.object({
  totpCode: z.string().trim().min(6).max(10),
});

export const mfaVerifyLoginSchema = z.object({
  challengeToken: z.string().min(1),
  totpCode: z.string().trim().min(6).max(10).optional(),
  recoveryCode: z.string().trim().min(8).max(32).optional(),
  captchaToken: z.string().min(1).optional(),
}).refine((v) => Boolean(v.totpCode || v.recoveryCode), {
  message: 'Provide totpCode or recoveryCode',
});

export const mfaRemoveSelfSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  totpCode: z.string().trim().min(6).max(10).optional(),
  recoveryCode: z.string().trim().min(8).max(32).optional(),
}).refine((v) => Boolean(v.totpCode || v.recoveryCode), {
  message: 'Provide totpCode or recoveryCode',
});

export const mfaRegenerateRecoverySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  totpCode: z.string().trim().min(6).max(10),
});
