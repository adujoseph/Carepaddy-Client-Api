import * as jose from 'jose';
import { env } from '@config/env';
import type { UserRole } from '../generated/prisma/client.js';

export type AccessTokenPayload = {
  sub: string;
  userRole: UserRole;
  sessionId: string;
  tenantId?: string | null;
};

export type OtpVerifiedPayload = {
  purpose: 'otp_verified';
  email?: string;
  phone?: string;
};

export type PasswordResetPayload = {
  purpose: 'password_reset';
  jti: string;
  userId: string;
};

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new jose.SignJWT({
    userRole: payload.userRole,
    sessionId: payload.sessionId,
    tenantId: payload.tenantId ?? undefined,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.accessTokenTtlSeconds}s`)
    .sign(secretKey(env.jwtAccessSecret));
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(env.jwtAccessSecret));
  if (!payload.sub || typeof payload.sessionId !== 'string' || typeof payload.userRole !== 'string') {
    throw new Error('Invalid access token payload');
  }
  return {
    sub: payload.sub,
    userRole: payload.userRole as UserRole,
    sessionId: payload.sessionId,
    tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
  };
}

export async function signOtpVerifiedToken(payload: {
  email?: string;
  phone?: string;
}): Promise<string> {
  return new jose.SignJWT({
    purpose: 'otp_verified',
    email: payload.email,
    phone: payload.phone,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secretKey(env.jwtOtpSecret));
}

export async function verifyOtpVerifiedToken(token: string): Promise<OtpVerifiedPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(env.jwtOtpSecret));
  if (payload.purpose !== 'otp_verified') {
    throw new Error('Invalid OTP verification token');
  }
  return {
    purpose: 'otp_verified',
    email: typeof payload.email === 'string' ? payload.email : undefined,
    phone: typeof payload.phone === 'string' ? payload.phone : undefined,
  };
}

export async function signPasswordResetToken(payload: {
  jti: string;
  userId: string;
}): Promise<string> {
  return new jose.SignJWT({
    purpose: 'password_reset',
    jti: payload.jti,
    userId: payload.userId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secretKey(env.jwtResetSecret));
}

export async function verifyPasswordResetToken(token: string): Promise<PasswordResetPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(env.jwtResetSecret));
  if (
    payload.purpose !== 'password_reset' ||
    typeof payload.jti !== 'string' ||
    typeof payload.userId !== 'string'
  ) {
    throw new Error('Invalid password reset token');
  }
  return {
    purpose: 'password_reset',
    jti: payload.jti,
    userId: payload.userId,
  };
}

export type InviteTokenPayload = {
  purpose: 'invite';
  jti: string;
  tenantId: string;
  residentId: string;
  guardianName: string;
  email?: string | null;
  phone?: string | null;
};

export async function signInviteToken(payload: Omit<InviteTokenPayload, 'purpose'>): Promise<string> {
  return new jose.SignJWT({
    purpose: 'invite',
    jti: payload.jti,
    tenantId: payload.tenantId,
    residentId: payload.residentId,
    guardianName: payload.guardianName,
    email: payload.email ?? null,
    phone: payload.phone ?? null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime('72h')
    .sign(secretKey(env.jwtInviteSecret));
}

export async function verifyInviteToken(token: string): Promise<InviteTokenPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(env.jwtInviteSecret));
  if (
    payload.purpose !== 'invite' ||
    typeof payload.jti !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.residentId !== 'string' ||
    typeof payload.guardianName !== 'string'
  ) {
    throw new Error('Invalid invite token');
  }
  return {
    purpose: 'invite',
    jti: payload.jti,
    tenantId: payload.tenantId,
    residentId: payload.residentId,
    guardianName: payload.guardianName,
    email: typeof payload.email === 'string' ? payload.email : null,
    phone: typeof payload.phone === 'string' ? payload.phone : null,
  };
}

export type StaffInviteTokenPayload = {
  purpose: 'staff_invite';
  jti: string;
  userId: string;
  tenantId: string;
  email: string;
};

export async function signStaffInviteToken(
  payload: Omit<StaffInviteTokenPayload, 'purpose'>,
): Promise<string> {
  return new jose.SignJWT({
    purpose: 'staff_invite',
    jti: payload.jti,
    userId: payload.userId,
    tenantId: payload.tenantId,
    email: payload.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime('72h')
    .sign(secretKey(env.jwtInviteSecret));
}

export async function verifyStaffInviteToken(token: string): Promise<StaffInviteTokenPayload> {
  const { payload } = await jose.jwtVerify(token, secretKey(env.jwtInviteSecret));
  if (
    payload.purpose !== 'staff_invite' ||
    typeof payload.jti !== 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.email !== 'string'
  ) {
    throw new Error('Invalid staff invite token');
  }
  return {
    purpose: 'staff_invite',
    jti: payload.jti,
    userId: payload.userId,
    tenantId: payload.tenantId,
    email: payload.email,
  };
}
