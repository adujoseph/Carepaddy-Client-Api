import { env } from '@config/env';
import { logger } from '@lib/logger';

/** Verify Cloudflare Turnstile token when TURNSTILE_SECRET_KEY is configured. */
export async function verifyCaptchaToken(token: string | undefined, remoteIp?: string): Promise<boolean> {
  const secret = env.turnstileSecretKey;
  if (!secret) {
    return Boolean(token?.trim());
  }
  if (!token?.trim()) {
    return false;
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: token.trim(),
      ...(remoteIp ? { remoteip: remoteIp } : {}),
    });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Turnstile verify HTTP error');
      return false;
    }
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    logger.warn({ err }, 'Turnstile verify failed');
    return false;
  }
}
