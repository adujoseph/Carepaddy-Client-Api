import dotenv from 'dotenv';
dotenv.config({ quiet: true });

/** Strip common .env paste artifacts: surrounding quotes and trailing commas. */
function cleanEnvValue(value: string): string {
  let v = value.trim();
  if (v.endsWith(',')) {
    v = v.slice(0, -1).trim();
  }
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  if (value === undefined) return undefined;
  const cleaned = cleanEnvValue(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function required(key: string): string {
  const value = readEnv(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return readEnv(key) ?? fallback;
}

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value ?? fallback}`);
  }
  return port;
}

const jwtAccessSecret = required('JWT_ACCESS_SECRET');
const port = parsePort(readEnv('PORT'), 4000);

export const env = {
  nodeEnv: readEnv('NODE_ENV') ?? 'development',
  port,
  databaseUrl: required('DATABASE_URL'),
  jwtAccessSecret,
  jwtInviteSecret: optional('JWT_INVITE_SECRET', jwtAccessSecret),
  jwtResetSecret: optional('JWT_RESET_SECRET', jwtAccessSecret),
  jwtOtpSecret: optional('JWT_OTP_SECRET', jwtAccessSecret),
  /** Admin back-office access token lifetime (spec: 8h absolute session cap). */
  adminAccessTokenTtlSeconds: Number(optional('ADMIN_ACCESS_TOKEN_TTL_SECONDS', String(8 * 60 * 60))),
  /** Client app access token (short-lived). */
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 30,
  /** Admin idle timeout — session invalid after this many seconds without activity. */
  adminSessionIdleSeconds: Number(optional('ADMIN_SESSION_IDLE_SECONDS', String(30 * 60))),
  /** Cloudflare Turnstile secret; when set, admin login CAPTCHA tokens are verified. */
  turnstileSecretKey: readEnv('TURNSTILE_SECRET_KEY'),
  appPublicUrl: optional('APP_PUBLIC_URL', 'http://localhost:3000'),

  redisUrl: optional('REDIS_URL', 'redis://127.0.0.1:6379'),
  /**
   * OTP / rate-limit backend.
   * - development default: memory (no Redis required)
   * - production default: redis
   * Override with KV_STORE=memory|redis
   */
  kvStore: (readEnv('KV_STORE') ??
    ((readEnv('NODE_ENV') ?? 'development') === 'production' ? 'redis' : 'memory')) as
    | 'memory'
    | 'redis',

  /** UK address list by postcode — getAddress.io */
  getAddressApiKey: readEnv('GETADDRESS_API_KEY'),

  awsRegion: optional('AWS_REGION', 'eu-west-2'),
  awsAccessKeyId: readEnv('AWS_ACCESS_KEY_ID'),
  awsSecretAccessKey: readEnv('AWS_SECRET_ACCESS_KEY'),
  sesFromEmail: optional('SES_FROM_EMAIL', 'no-reply@carepaddy.com'),
  snsSenderId: optional('SNS_SENDER_ID', 'CarePaddy'),

  /** Public base URL for locally stored profile images (e.g. https://api.example.com). */
  apiPublicUrl: optional('API_PUBLIC_URL', `http://localhost:${port}`),

  otpCodeTtlSeconds: Number(optional('OTP_CODE_TTL_SECONDS', '300')),
  otpRequestLimit: Number(optional('OTP_REQUEST_LIMIT', '3')),
  otpRequestWindowSeconds: Number(optional('OTP_REQUEST_WINDOW_SECONDS', '600')),
};
