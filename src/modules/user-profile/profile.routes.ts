import { Router } from 'express';
import { requireAuth } from '@middleware/auth';
import { validateBody } from '@middleware/validate';
import { registry } from '@docs/registry';
import {
  changeUserPasswordSchema,
  disableAccountSchema,
  updateProfileImageSchema,
  updateUserProfileSchema,
} from './profile.schema.js';
import {
  changeUserPasswordController,
  disableAccountController,
  getUserProfileController,
  updateProfileImageController,
  updateUserProfileController,
} from './profile.controller.js';

export const profileRouter = Router();

registry.registerPath({
  method: 'get',
  path: '/client/getUserProfile',
  tags: ['User Profile'],
  summary: 'Get the authenticated user profile',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'User profile' },
    401: { description: 'Unauthorized' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/client/updateUserProfile',
  tags: ['User Profile'],
  summary: 'Update name, email, phone, and/or address on the authenticated profile',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: updateUserProfileSchema } } },
  },
  responses: {
    200: { description: 'Profile updated' },
    400: { description: 'Validation error' },
    401: { description: 'Unauthorized' },
    409: { description: 'Email or phone already in use' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/updateProfileImage',
  tags: ['User Profile'],
  summary: 'Upload a new profile image (base64 JPEG/PNG/WebP, max 2MB)',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: updateProfileImageSchema } } },
  },
  responses: {
    200: { description: 'Profile image updated' },
    400: { description: 'Invalid image' },
    401: { description: 'Unauthorized' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/changeUserPassword',
  tags: ['User Profile'],
  summary: 'Change password for the authenticated user (requires current password)',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: changeUserPasswordSchema } } },
  },
  responses: {
    200: { description: 'Password updated' },
    400: { description: 'Invalid current password or weak new password' },
    401: { description: 'Unauthorized' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/disableAccount',
  tags: ['User Profile'],
  summary: 'Self-disable the authenticated account (revokes all sessions)',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: disableAccountSchema } } },
  },
  responses: {
    200: { description: 'Account disabled' },
    400: { description: 'Cannot disable last care admin' },
    401: { description: 'Unauthorized' },
    409: { description: 'Already disabled' },
  },
});

profileRouter.get('/getUserProfile', requireAuth, getUserProfileController);
profileRouter.put(
  '/updateUserProfile',
  requireAuth,
  validateBody(updateUserProfileSchema),
  updateUserProfileController,
);
profileRouter.post(
  '/updateProfileImage',
  requireAuth,
  validateBody(updateProfileImageSchema),
  updateProfileImageController,
);
profileRouter.post(
  '/changeUserPassword',
  requireAuth,
  validateBody(changeUserPasswordSchema),
  changeUserPasswordController,
);
profileRouter.post(
  '/disableAccount',
  requireAuth,
  validateBody(disableAccountSchema),
  disableAccountController,
);
