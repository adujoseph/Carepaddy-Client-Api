import { randomInt } from 'node:crypto';
import { z } from '@docs/zod-extend';
import { kvStore } from '@lib/kvStore';
import { enforceRateLimit } from '@lib/rateLimiter';
import { signOtpVerifiedToken } from '@lib/jwt';
import { normalizeEmail, normalizePhone } from '@lib/normalize';
import { logger } from '@lib/logger';
import { AppError } from '@middleware/error-handler';
import { emailSender, smsSender } from '../../../providers/notify.js';

const OTP_TTL_SECONDS = 10 * 60;
const OTP_RATE_LIMIT = 3;
const OTP_MAX_ATTEMPTS = 5;

type OtpEntry = {
  code: string;
  attempts: number;
  createdAt: number;
  verified?: boolean;
};

export const initiateOtpSchema = z
  .object({
    email: z.email().optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be E.164-ish')
      .optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'Either email or phone is required',
  });

export const verifyOtpSchema = z
  .object({
    email: z.email().optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be E.164-ish')
      .optional(),
    otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6-digit code'),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'Either email or phone is required',
  });

export type InitiateOtpInput = z.infer<typeof initiateOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

function resolveIdentifier(input: { email?: string; phone?: string }): {
  key: string;
  email?: string;
  phone?: string;
} {
  if (input.email) {
    const email = normalizeEmail(input.email);
    return { key: `email:${email}`, email };
  }
  const phone = normalizePhone(input.phone!);
  return { key: `phone:${phone}`, phone };
}

function otpStoreKey(identifierKey: string): string {
  return `otp:${identifierKey}`;
}

export async function initiateOtp(input: InitiateOtpInput): Promise<{ message: string }> {
  const { key, email, phone } = resolveIdentifier(input);
  const storeKey = otpStoreKey(key);

  await enforceRateLimit({
    key: `otp:rate:${key}`,
    limit: OTP_RATE_LIMIT,
    windowSeconds: OTP_TTL_SECONDS,
    message: 'Too many requests. Please try again later.',
    code: 'RATE_LIMITED',
  });

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const entry: OtpEntry = {
    code,
    attempts: 0,
    createdAt: Date.now(),
  };
  await kvStore.set(storeKey, entry, OTP_TTL_SECONDS);

  try {
    if (email) {
      await emailSender.send({
        to: email,
        subject: 'Your CarePaddy verification code',
        body: `Your verification code is ${code}. It expires in 10 minutes.`,
      });
      return { message: 'OTP has been sent to your email address.' };
    }

    await smsSender.send({
      to: phone!,
      body: `Your CarePaddy verification code is ${code}. It expires in 10 minutes.`,
    });
    return { message: 'OTP has been sent to your phone number.' };
  } catch (err) {
    await kvStore.del(storeKey);
    logger.warn({ err, email, phone }, 'OTP dispatch failed');
    throw new AppError(
      502,
      'We could not send the verification code right now. Please try again shortly.',
      'OTP_SEND_FAILED',
    );
  }
}

export async function verifyOtp(input: VerifyOtpInput): Promise<{ verificationToken: string }> {
  const { key, email, phone } = resolveIdentifier(input);
  const storeKey = otpStoreKey(key);
  const entry = await kvStore.get<OtpEntry>(storeKey);

  if (!entry || entry.verified) {
    throw new AppError(400, 'Invalid or expired code', 'INVALID_OTP');
  }

  if (entry.code !== input.otp) {
    const attempts = entry.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await kvStore.del(storeKey);
      throw new AppError(429, 'Too many invalid attempts. Please request a new code.', 'OTP_ATTEMPTS_EXHAUSTED');
    }
    await kvStore.set(storeKey, { ...entry, attempts }, OTP_TTL_SECONDS);
    throw new AppError(400, 'Invalid or expired code', 'INVALID_OTP');
  }

  await kvStore.set(
    storeKey,
    { ...entry, verified: true, attempts: entry.attempts },
    OTP_TTL_SECONDS,
  );

  const verificationToken = await signOtpVerifiedToken({ email, phone });
  return { verificationToken };
}
