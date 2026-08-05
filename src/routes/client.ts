import { Router } from 'express';
import { z } from '@docs/zod-extend';
import { validateBody, validateQuery } from '@middleware/validate';
import { requireAuth } from '@middleware/auth';
import { registry } from '@docs/registry';

import { registerCarehomeSchema } from '@modules/auth/carehome/register.schema';
import { registerCarehomeController } from '@modules/auth/carehome/register.controller';
import { loginSchema, logoutSchema, refreshSchema } from '@modules/auth/session/session.schema';
import {
  loginController,
  logoutController,
  refreshController,
} from '@modules/auth/session/session.controller';
import { initiateOtpSchema, verifyOtpSchema } from '@modules/auth/otp/otp.service';
import { initiateOtpController, verifyOtpController } from '@modules/auth/otp/otp.controller';
import {
  resetPasswordConfirmSchema,
  resetPasswordSchema,
} from '@modules/auth/password/password.service';
import {
  resetPasswordConfirmController,
  resetPasswordController,
} from '@modules/auth/password/password.controller';
import { listCarehomesQuerySchema } from '@modules/lookup/carehomes/list.service';
import { listCarehomesController } from '@modules/lookup/carehomes/list.controller';
import { postcodeQuerySchema } from '@modules/lookup/postcode/postcode.service';
import { postcodeController } from '@modules/lookup/postcode/postcode.controller';
import { cqcLookupSchema } from '@modules/lookup/cqc/cqc.service';
import { cqcController } from '@modules/lookup/cqc/cqc.controller';
import {
  completeInvitationSchema,
  createInvitationSchema,
  verifyInvitationQuerySchema,
} from '@modules/auth/invitation/invitation.service';
import {
  completeInvitationController,
  createInvitationController,
  verifyInvitationController,
} from '@modules/auth/invitation/invitation.controller';
import { selfRegisterSchema } from '@modules/auth/guardian/self-register.service';
import { selfRegisterController } from '@modules/auth/guardian/self-register.controller';
import {
  listGuardianRegistrationsQuerySchema,
  reviewGuardianRegistrationSchema,
} from '@modules/auth/guardian/registration-approval.service';
import {
  listGuardianRegistrationsController,
  reviewGuardianRegistrationController,
} from '@modules/auth/guardian/registration-approval.controller';
import {
  createResidentSchema,
} from '@modules/residents/resident.service';
import {
  createResidentController,
  listResidentsController,
} from '@modules/residents/resident.controller';
import { requireRoles } from '@middleware/roles';

export const clientRouter = Router();

registry.registerPath({
  method: 'post',
  path: '/client/auth/register-carehome',
  tags: ['Client Auth'],
  summary: 'Register a carehome and its first care_admin user (requires prior OTP verification)',
  request: {
    body: { content: { 'application/json': { schema: registerCarehomeSchema } } },
  },
  responses: {
    201: { description: 'Carehome created' },
    400: { description: 'Validation / verification required' },
    409: { description: 'Duplicate email/phone/CQC number' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/auth/login',
  tags: ['Client Auth'],
  summary: 'Login with email or phone',
  request: {
    body: { content: { 'application/json': { schema: loginSchema } } },
  },
  responses: {
    200: { description: 'Logged in' },
    401: { description: 'Invalid credentials' },
    423: { description: 'Account locked' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/auth/refresh',
  tags: ['Client Auth'],
  summary: 'Rotate refresh token and issue a new access token',
  request: {
    body: { content: { 'application/json': { schema: refreshSchema } } },
  },
  responses: {
    200: { description: 'Tokens rotated' },
    401: { description: 'Invalid refresh token' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/auth/logout',
  tags: ['Client Auth'],
  summary: 'Revoke current session (or all sessions)',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: logoutSchema } } },
  },
  responses: {
    204: { description: 'Logged out' },
    401: { description: 'Unauthorized' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/initiateOTP',
  tags: ['Client Auth'],
  summary: 'Send a one-time verification code',
  request: {
    body: { content: { 'application/json': { schema: initiateOtpSchema } } },
  },
  responses: {
    200: { description: 'OTP sent successfully' },
    400: { description: 'Validation error' },
    429: { description: 'Rate limited' },
    502: { description: 'Failed to send OTP' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/verifyOTP',
  tags: ['Client Auth'],
  summary: 'Verify a one-time code and receive a short-lived verification token',
  request: {
    body: { content: { 'application/json': { schema: verifyOtpSchema } } },
  },
  responses: {
    200: { description: 'OTP verified' },
    400: { description: 'Invalid or expired code' },
    429: { description: 'Attempts exhausted' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/auth/resetPassword',
  tags: ['Client Auth'],
  summary: 'Request a password reset email',
  request: {
    body: { content: { 'application/json': { schema: resetPasswordSchema } } },
  },
  responses: {
    200: { description: 'Generic success' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/auth/resetPassword/confirm',
  tags: ['Client Auth'],
  summary: 'Confirm password reset with token',
  request: {
    body: { content: { 'application/json': { schema: resetPasswordConfirmSchema } } },
  },
  responses: {
    200: { description: 'Password updated' },
    400: { description: 'Weak password' },
    410: { description: 'Invalid or expired token' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/client/carehomes',
  tags: ['Lookups'],
  summary: 'List carehomes (public, minimal fields)',
  request: {
    query: listCarehomesQuerySchema,
  },
  responses: {
    200: { description: 'Paginated carehome list' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/client/postcode',
  tags: ['Lookups'],
  summary: 'Lookup UK address list by postcode (getAddress.io)',
  request: {
    query: postcodeQuerySchema,
  },
  responses: {
    200: { description: 'Array of selectable addresses' },
    502: { description: 'Upstream unavailable' },
    503: { description: 'GETADDRESS_API_KEY not configured' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/cqc',
  tags: ['Lookups'],
  summary: 'On-demand CQC provider check (mock)',
  request: {
    body: { content: { 'application/json': { schema: cqcLookupSchema } } },
  },
  responses: {
    200: { description: 'CQC verification result' },
    429: { description: 'Rate limited' },
  },
});

clientRouter.post(
  '/auth/register-carehome',
  validateBody(registerCarehomeSchema),
  registerCarehomeController,
);
clientRouter.post('/auth/login', validateBody(loginSchema), loginController);
clientRouter.post('/auth/refresh', validateBody(refreshSchema), refreshController);
clientRouter.post('/auth/logout', requireAuth, validateBody(logoutSchema), logoutController);

clientRouter.post('/initiateOTP', validateBody(initiateOtpSchema), initiateOtpController);
clientRouter.post('/verifyOTP', validateBody(verifyOtpSchema), verifyOtpController);

clientRouter.post('/auth/resetPassword', validateBody(resetPasswordSchema), resetPasswordController);
clientRouter.post(
  '/auth/resetPassword/confirm',
  validateBody(resetPasswordConfirmSchema),
  resetPasswordConfirmController,
);

clientRouter.get('/carehomes', validateQuery(listCarehomesQuerySchema), listCarehomesController);
clientRouter.get('/postcode', validateQuery(postcodeQuerySchema), postcodeController);
clientRouter.post('/cqc', validateBody(cqcLookupSchema), cqcController);

registry.registerPath({
  method: 'post',
  path: '/client/residents',
  tags: ['Residents'],
  summary: 'Register a resident for the authenticated carehome (required before inviting a guardian)',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: createResidentSchema } } },
  },
  responses: {
    201: { description: 'Resident created' },
    403: { description: 'Forbidden' },
    409: { description: 'Duplicate resident number' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/client/residents',
  tags: ['Residents'],
  summary: 'List residents for the authenticated carehome',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Resident list' },
    403: { description: 'Forbidden' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/invitation',
  tags: ['Invitations'],
  summary: 'Invite a guardian for a pre-registered resident (carehome staff)',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: createInvitationSchema } } },
  },
  responses: {
    201: { description: 'Invitation created' },
    403: { description: 'Forbidden' },
    429: { description: 'Rate limited' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/client/invitations/verify',
  tags: ['Invitations'],
  summary: 'Verify an invitation token and return prefill data',
  request: { query: verifyInvitationQuerySchema },
  responses: {
    200: { description: 'Invitation valid' },
    404: { description: 'Not found' },
    409: { description: 'Already used' },
    410: { description: 'Expired' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/auth/complete-invitation',
  tags: ['Invitations'],
  summary: 'Complete guardian registration via invitation (requires prior OTP verification)',
  request: {
    body: { content: { 'application/json': { schema: completeInvitationSchema } } },
  },
  responses: {
    201: { description: 'Guardian registered and logged in' },
    400: { description: 'Validation / verification / mismatch' },
    409: { description: 'Invite already used' },
    410: { description: 'Expired' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/auth/register',
  tags: ['Client Auth'],
  summary:
    'Guardian self-service registration without invite (requires OTP; pending until carehome approval)',
  request: {
    body: { content: { 'application/json': { schema: selfRegisterSchema } } },
  },
  responses: {
    201: { description: 'Registered pending approval' },
    400: { description: 'Verification required' },
    404: { description: 'Carehome not found' },
    409: { description: 'Duplicate account' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/client/guardian-registrations',
  tags: ['Guardian Approvals'],
  summary: 'List guardian self-registrations awaiting carehome approval',
  security: [{ bearerAuth: [] }],
  request: { query: listGuardianRegistrationsQuerySchema },
  responses: {
    200: { description: 'Pending (or filtered) registration requests' },
    403: { description: 'Forbidden' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/guardian-registrations/{id}',
  tags: ['Guardian Approvals'],
  summary: 'Approve or reject a guardian registration',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { 'application/json': { schema: reviewGuardianRegistrationSchema } } },
  },
  responses: {
    200: { description: 'Registration reviewed (approved or rejected)' },
    400: { description: 'Missing reason on reject, or missing residentId on approve' },
    403: { description: 'Forbidden' },
    404: { description: 'Not found' },
    409: { description: 'Already reviewed or already linked' },
  },
});

clientRouter.post(
  '/residents',
  requireAuth,
  requireRoles('care_admin', 'care_staff'),
  validateBody(createResidentSchema),
  createResidentController,
);
clientRouter.get(
  '/residents',
  requireAuth,
  requireRoles('care_admin', 'care_staff'),
  listResidentsController,
);

clientRouter.post(
  '/invitation',
  requireAuth,
  requireRoles('care_admin', 'care_staff'),
  validateBody(createInvitationSchema),
  createInvitationController,
);
clientRouter.get(
  '/invitations/verify',
  validateQuery(verifyInvitationQuerySchema),
  verifyInvitationController,
);
clientRouter.post(
  '/auth/complete-invitation',
  validateBody(completeInvitationSchema),
  completeInvitationController,
);
clientRouter.post('/auth/register', validateBody(selfRegisterSchema), selfRegisterController);

clientRouter.get(
  '/guardian-registrations',
  requireAuth,
  requireRoles('care_admin', 'care_staff'),
  validateQuery(listGuardianRegistrationsQuerySchema),
  listGuardianRegistrationsController,
);
clientRouter.post(
  '/guardian-registrations/:id',
  requireAuth,
  requireRoles('care_admin', 'care_staff'),
  validateBody(reviewGuardianRegistrationSchema),
  reviewGuardianRegistrationController,
);
