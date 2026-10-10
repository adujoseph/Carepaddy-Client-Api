import * as jose from 'jose';
import { env } from '@config/env';

export type AdminAccessTokenPayload = {
  sub: string;
  sessionId: string;
  tokenKind: 'admin';
};

export type AdminInviteTokenPayload = {
  purpose: 'admin_invite';
  jti: string;
  adminUserId: string;
  email: string;
};

export type AdminPasswordResetPayload = {
  purpose: 'admin_password_reset';
  jti: string;
  adminUserId: string;
};

export type AdminMfaChallengePayload = {
  purpose: 'admin_mfa_challenge';
  adminUserId: string;
};

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAdminAccessToken(payload: Omit<AdminAccessTokenPayload, 'tokenKind'>): Promise<string> {
  return new jose.SignJWT({
    tokenKind: 'admin',
    sessionId: payload.sessionId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.adminAccessTokenTtlSeconds}s`)
    .sign(secretKey(env.jwtAccessSecret));
}

export async function verifyAdminAccessToken(token: string): Promise<AdminAccessTokenPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(env.jwtAccessSecret));
  if (payload.tokenKind !== 'admin' || !payload.sub || typeof payload.sessionId !== 'string') {
    throw new Error('Invalid admin access token');
  }
  return { sub: payload.sub, sessionId: payload.sessionId, tokenKind: 'admin' };
}

export async function signAdminInviteToken(
  payload: Omit<AdminInviteTokenPayload, 'purpose'>,
): Promise<string> {
  return new jose.SignJWT({
    purpose: 'admin_invite',
    jti: payload.jti,
    adminUserId: payload.adminUserId,
    email: payload.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime('48h')
    .sign(secretKey(env.jwtInviteSecret));
}

export async function verifyAdminInviteToken(token: string): Promise<AdminInviteTokenPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(env.jwtInviteSecret));
  if (
    payload.purpose !== 'admin_invite' ||
    typeof payload.jti !== 'string' ||
    typeof payload.adminUserId !== 'string' ||
    typeof payload.email !== 'string'
  ) {
    throw new Error('Invalid admin invite token');
  }
  return {
    purpose: 'admin_invite',
    jti: payload.jti,
    adminUserId: payload.adminUserId,
    email: payload.email,
  };
}

export async function signAdminPasswordResetToken(payload: {
  jti: string;
  adminUserId: string;
}): Promise<string> {
  return new jose.SignJWT({
    purpose: 'admin_password_reset',
    jti: payload.jti,
    adminUserId: payload.adminUserId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.adminUserId)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey(env.jwtResetSecret));
}

export async function signAdminMfaChallengeToken(adminUserId: string): Promise<string> {
  return new jose.SignJWT({
    purpose: 'admin_mfa_challenge',
    adminUserId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(adminUserId)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secretKey(env.jwtAccessSecret));
}

export async function verifyAdminMfaChallengeToken(token: string): Promise<AdminMfaChallengePayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(env.jwtAccessSecret));
  if (payload.purpose !== 'admin_mfa_challenge' || typeof payload.adminUserId !== 'string') {
    throw new Error('Invalid MFA challenge token');
  }
  return { purpose: 'admin_mfa_challenge', adminUserId: payload.adminUserId };
}

export async function verifyAdminPasswordResetToken(token: string): Promise<AdminPasswordResetPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(env.jwtResetSecret));
  if (
    payload.purpose !== 'admin_password_reset' ||
    typeof payload.jti !== 'string' ||
    typeof payload.adminUserId !== 'string'
  ) {
    throw new Error('Invalid admin password reset token');
  }
  return {
    purpose: 'admin_password_reset',
    jti: payload.jti,
    adminUserId: payload.adminUserId,
  };
}
