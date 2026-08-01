import { verifyOtpVerifiedToken } from '@lib/jwt';
import { normalizeEmail, normalizePhone } from '@lib/normalize';
import { AppError } from '@middleware/error-handler';

export type VerifiedContact = {
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
};

/**
 * Ensures the caller completed OTP verify for the email and/or phone
 * they are registering with. Backend gate — not a frontend-only check.
 */
export async function requireVerifiedContact(options: {
  verificationToken: string;
  email?: string | null;
  phone?: string | null;
}): Promise<VerifiedContact> {
  let payload: Awaited<ReturnType<typeof verifyOtpVerifiedToken>>;
  try {
    payload = await verifyOtpVerifiedToken(options.verificationToken);
  } catch {
    throw new AppError(
      400,
      'Email or phone verification is required before registration',
      'VERIFICATION_REQUIRED',
    );
  }

  const email = options.email ? normalizeEmail(options.email) : null;
  const phone = options.phone ? normalizePhone(options.phone) : null;
  const tokenEmail = payload.email ? normalizeEmail(payload.email) : null;
  const tokenPhone = payload.phone ? normalizePhone(payload.phone) : null;

  const isEmailVerified = Boolean(email && tokenEmail && email === tokenEmail);
  const isPhoneVerified = Boolean(phone && tokenPhone && phone === tokenPhone);

  if (!isEmailVerified && !isPhoneVerified) {
    throw new AppError(
      400,
      'Verification token does not match the provided email or phone',
      'VERIFICATION_MISMATCH',
    );
  }

  return { isEmailVerified, isPhoneVerified };
}
