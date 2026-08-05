import { prisma } from '@lib/prisma';
import { normalizeEmail, normalizePhone } from '@lib/normalize';
import {
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
} from '@lib/password';
import {
  decodeProfileImageBase64,
  storeProfileImage,
} from '@lib/storage/profile-image';
import { AppError } from '@middleware/error-handler';
import type {
  AddressInput,
  ChangeUserPasswordInput,
  UpdateProfileImageInput,
  UpdateUserProfileInput,
} from './profile.schema.js';

const userProfileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  profileImageUrl: true,
  addressLine: true,
  city: true,
  postcode: true,
  userType: true,
  userRole: true,
  status: true,
  isEmailVerified: true,
  isPhoneVerified: true,
  tenantId: true,
  termsAcceptedAt: true,
  createdAt: true,
} as const;

type UserProfileRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  profileImageUrl: string | null;
  addressLine: string | null;
  city: string | null;
  postcode: string | null;
  userType: string;
  userRole: string;
  status: string;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  tenantId: string | null;
  termsAcceptedAt: Date | null;
  createdAt: Date;
};

function toAddress(user: Pick<UserProfileRow, 'addressLine' | 'city' | 'postcode'>) {
  if (!user.addressLine && !user.city && !user.postcode) {
    return null;
  }
  return {
    fullAddress: user.addressLine,
    city: user.city,
    postcode: user.postcode,
  };
}

function serializeUser(user: UserProfileRow, extras: Record<string, unknown> = {}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    profileImageUrl: user.profileImageUrl,
    address: toAddress(user),
    userType: user.userType,
    userRole: user.userRole,
    status: user.status,
    isEmailVerified: user.isEmailVerified,
    isPhoneVerified: user.isPhoneVerified,
    tenantId: user.tenantId,
    termsAcceptedAt: user.termsAcceptedAt,
    createdAt: user.createdAt,
    ...extras,
  };
}

function addressUpdateData(address: AddressInput) {
  return {
    addressLine: address.fullAddress.trim(),
    city: address.city.trim(),
    postcode: address.postcode.trim().toUpperCase().replace(/\s+/g, ' '),
  };
}

async function loadUserOrThrow(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userProfileSelect,
  });
  if (!user) {
    throw new AppError(404, 'User not found', 'NOT_FOUND');
  }
  return user;
}

export async function getUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...userProfileSelect,
      carehome: {
        select: {
          id: true,
          name: true,
          cqcNumber: true,
          email: true,
          phone: true,
          addressLine: true,
          city: true,
          postcode: true,
          status: true,
          cqcCheck: true,
        },
      },
      guardianLinks: {
        select: {
          id: true,
          status: true,
          residentId: true,
          tenantId: true,
          resident: { select: { id: true, name: true, residentNumber: true } },
          carehome: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!user) {
    throw new AppError(404, 'User not found', 'NOT_FOUND');
  }

  const { carehome, guardianLinks, ...base } = user;

  if (user.userRole === 'guardian') {
    return serializeUser(base, {
      residentLinks: guardianLinks.map((link) => ({
        linkId: link.id,
        status: link.status,
        residentId: link.residentId,
        residentName: link.resident.name,
        residentNumber: link.resident.residentNumber,
        tenantId: link.tenantId,
        carehomeName: link.carehome.name,
      })),
    });
  }

  return serializeUser(base, {
    carehome: carehome
      ? {
          ...carehome,
          address: {
            fullAddress: carehome.addressLine,
            city: carehome.city,
            postcode: carehome.postcode,
          },
        }
      : null,
  });
}

export async function updateUserProfile(userId: string, input: UpdateUserProfileInput) {
  const current = await loadUserOrThrow(userId);

  const data: {
    name?: string;
    email?: string | null;
    phone?: string;
    isEmailVerified?: boolean;
    isPhoneVerified?: boolean;
    addressLine?: string;
    city?: string;
    postcode?: string;
  } = {};

  if (input.name !== undefined) {
    data.name = input.name.trim();
  }

  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    if (email !== current.email) {
      const taken = await prisma.user.findFirst({
        where: { email, NOT: { id: userId } },
      });
      if (taken) {
        throw new AppError(409, 'An account with this email already exists', 'CONFLICT');
      }
      data.email = email;
      data.isEmailVerified = false;
    }
  }

  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    if (phone !== current.phone) {
      const taken = await prisma.user.findFirst({
        where: { phone, NOT: { id: userId } },
      });
      if (taken) {
        throw new AppError(409, 'An account with this phone already exists', 'CONFLICT');
      }
      data.phone = phone;
      data.isPhoneVerified = false;
    }
  }

  if (input.address !== undefined) {
    Object.assign(data, addressUpdateData(input.address));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data,
      select: {
        ...userProfileSelect,
        carehome: {
          select: {
            id: true,
            name: true,
            cqcNumber: true,
            email: true,
            phone: true,
            addressLine: true,
            city: true,
            postcode: true,
            status: true,
            cqcCheck: true,
          },
        },
      },
    });

    // Keep carehome org address in sync when care staff update their profile address.
    if (
      input.address &&
      current.tenantId &&
      (current.userRole === 'care_admin' || current.userRole === 'care_staff')
    ) {
      const carehomeAddress = addressUpdateData(input.address);
      await tx.carehome.update({
        where: { id: current.tenantId },
        data: carehomeAddress,
      });
      if (user.carehome) {
        user.carehome.addressLine = carehomeAddress.addressLine;
        user.carehome.city = carehomeAddress.city;
        user.carehome.postcode = carehomeAddress.postcode;
      }
    }

    return user;
  });

  const { carehome, ...base } = updated;

  if (base.userRole === 'guardian') {
    return serializeUser(base);
  }

  return serializeUser(base, {
    carehome: carehome
      ? {
          ...carehome,
          address: {
            fullAddress: carehome.addressLine,
            city: carehome.city,
            postcode: carehome.postcode,
          },
        }
      : null,
  });
}

export async function updateProfileImage(userId: string, input: UpdateProfileImageInput) {
  await loadUserOrThrow(userId);

  const buffer = decodeProfileImageBase64(input.imageBase64);
  const profileImageUrl = await storeProfileImage({
    userId,
    buffer,
    contentType: input.contentType,
  });

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { profileImageUrl },
    select: userProfileSelect,
  });

  return serializeUser(updated);
}

export async function changeUserPassword(userId: string, input: ChangeUserPasswordInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, password: true },
  });

  if (!user) {
    throw new AppError(404, 'User not found', 'NOT_FOUND');
  }

  const currentOk = await verifyPassword(user.password, input.currentPassword);
  if (!currentOk) {
    throw new AppError(400, 'Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  }

  if (input.currentPassword === input.newPassword) {
    throw new AppError(
      400,
      'New password must be different from the current password',
      'PASSWORD_UNCHANGED',
    );
  }

  await assertPasswordPolicy(input.newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { password: await hashPassword(input.newPassword) },
  });

  return { message: 'Password updated successfully' };
}

export async function disableAccount(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, userRole: true, tenantId: true },
  });

  if (!user) {
    throw new AppError(404, 'User not found', 'NOT_FOUND');
  }

  if (user.status === 'suspended') {
    throw new AppError(409, 'Account is already disabled', 'ALREADY_DISABLED');
  }

  if (user.userRole === 'care_admin' && user.tenantId) {
    const adminCount = await prisma.user.count({
      where: {
        tenantId: user.tenantId,
        userRole: 'care_admin',
        status: 'active',
      },
    });
    if (adminCount <= 1) {
      throw new AppError(
        400,
        'You cannot disable the only active care admin. Assign another admin first.',
        'LAST_ADMIN',
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { status: 'suspended' },
    });
    await tx.session.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  });

  return { message: 'Account disabled successfully' };
}
