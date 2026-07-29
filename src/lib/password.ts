import { createHash } from 'node:crypto';
import argon2 from 'argon2';
import { AppError } from '@middleware/error-handler';
import { logger } from '@lib/logger';

const MIN_LENGTH = 12;

/** Compact common-password denylist (local, always applied). */
const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password123',
    'password1234',
    'password12345',
    '123456789012',
    'qwertyuiopas',
    'letmein12345',
    'welcome12345',
    'adminadmin12',
    'changeme1234',
    'carepaddy123',
    'iloveyou1234',
  ].map((p) => p.toLowerCase()),
);

/** Precomputed dummy hash so not-found logins still pay argon2 verify cost. */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash('dummy-password-for-timing');
  }
  return dummyHashPromise;
}

/**
 * HaveIBeenPwned k-anonymity range API — only a SHA-1 prefix leaves the server.
 * Fail-open on network/API errors so a third-party outage never blocks signups.
 */
export async function isPasswordBreached(password: string): Promise<boolean> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: {
      'User-Agent': 'carepaddy-client-api',
      'Add-Padding': 'true',
    },
  });

  if (!res.ok) {
    throw new Error(`HIBP range API returned ${res.status}`);
  }

  const body = await res.text();
  return body.split('\n').some((line) => {
    const hashSuffix = line.trim().split(':')[0];
    return hashSuffix === suffix;
  });
}

function assertLocalPasswordPolicy(password: string): void {
  if (password.length < MIN_LENGTH) {
    throw new AppError(
      400,
      `Password must be at least ${MIN_LENGTH} characters.`,
      'WEAK_PASSWORD',
    );
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new AppError(400, 'Password is too common. Choose a stronger one.', 'WEAK_PASSWORD');
  }
}

/** Local rules + HIBP breach check (fail-open if HIBP is unreachable). */
export async function assertPasswordPolicy(password: string): Promise<void> {
  assertLocalPasswordPolicy(password);

  try {
    if (await isPasswordBreached(password)) {
      throw new AppError(
        400,
        'This password appears in a known data breach. Please choose a different one.',
        'BREACHED_PASSWORD',
      );
    }
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    logger.warn({ err }, 'password breach check unavailable; allowing password (fail-open)');
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Always runs a verify to reduce timing enumeration between found/not-found users. */
export async function verifyPasswordConstantTime(
  hash: string | null | undefined,
  password: string,
): Promise<boolean> {
  const target = hash ?? (await getDummyHash());
  const valid = await verifyPassword(target, password);
  return Boolean(hash) && valid;
}
