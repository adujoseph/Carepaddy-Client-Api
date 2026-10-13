import { Router, type NextFunction, type Response } from 'express';
import { registry } from '@docs/registry';
import { validateBody, validateQuery, type RequestWithValidatedQuery } from '@middleware/validate';
import { requireAdminPermission, type AdminAuthedRequest } from '@middleware/admin-auth';
import {
  activateCarehomeSchema,
  carehomeIdParamSchema,
  createCarehomeSchema,
  deactivateCarehomeSchema,
  listCarehomeRoomsQuerySchema,
  listCarehomesQuerySchema,
  markCarehomeActiveSchema,
  markCarehomeInactiveSchema,
  updateCarehomeSchema,
  type ListCarehomeRoomsQuery,
  type ListCarehomesQuery,
} from './carehome.schema.js';
import {
  activateCarehome,
  cancelCarehomeInvite,
  createCarehome,
  deactivateCarehome,
  getCarehomeProfile,
  listCarehomeRooms,
  listCarehomes,
  markCarehomeActive,
  markCarehomeInactive,
  resendCarehomeInvite,
  updateCarehome,
} from './carehome.service.js';

const TAG = 'Admin Care Homes';
const secured = { tags: [TAG], security: [{ bearerAuth: [] }] };
const errors = {
  403: { description: 'INSUFFICIENT_PERMISSION' },
  404: { description: 'NOT_FOUND' },
};

registry.registerPath({
  ...secured,
  method: 'get',
  path: '/admin/care-homes',
  summary: 'List, search and filter care homes (carehome:read)',
  description:
    'Newest first (createdAt, id). Search matches name, email, CQC number and phone. `counts` holds per-tab totals for the current search; `page` is clamped to the last valid page.',
  request: { query: listCarehomesQuerySchema },
  responses: { 200: { description: 'Paginated care homes with per-status counts' }, 403: errors[403] },
});

registry.registerPath({
  ...secured,
  method: 'post',
  path: '/admin/care-homes',
  summary: 'Add a care home and send the care admin invite (carehome:write)',
  description:
    'Creates the home with status `invited`. Email is the care admin login and must be unique platform-wide (case-insensitive; plus-addressed emails count as distinct). Phone is normalised to E.164. If the email fails to send, the home is still created with `inviteDeliveryFailed: true` — use resend.',
  request: { body: { content: { 'application/json': { schema: createCarehomeSchema } } } },
  responses: {
    201: { description: 'Care home created; invite result in `invite`' },
    403: errors[403],
    409: { description: 'DUPLICATE_CQC | DUPLICATE_EMAIL | DUPLICATE_PHONE' },
  },
});

registry.registerPath({
  ...secured,
  method: 'get',
  path: '/admin/care-homes/{id}',
  summary: 'Care home profile with stats, deactivation banner and status history (carehome:read)',
  request: { params: carehomeIdParamSchema },
  responses: { 200: { description: 'Care home profile' }, ...errors },
});

registry.registerPath({
  ...secured,
  method: 'get',
  path: '/admin/care-homes/{id}/rooms',
  summary: 'Rooms (residents) table for a care home (carehome:read)',
  request: { params: carehomeIdParamSchema, query: listCarehomeRoomsQuerySchema },
  responses: { 200: { description: 'Paginated rooms with per-status counts' }, ...errors },
});

registry.registerPath({
  ...secured,
  method: 'patch',
  path: '/admin/care-homes/{id}',
  summary: 'Edit name, email or phone (carehome:write)',
  description:
    'Send the `version` from your last read. Changing the email of an invited home re-issues the invite to the new address; for an activated home it signs the care admin out and notifies the old address.',
  request: {
    params: carehomeIdParamSchema,
    body: { content: { 'application/json': { schema: updateCarehomeSchema } } },
  },
  responses: {
    200: { description: 'Updated care home' },
    ...errors,
    409: { description: 'VERSION_CONFLICT | DUPLICATE_EMAIL | DUPLICATE_PHONE | CARE_HOME_DEACTIVATED' },
    422: { description: 'CQC_IMMUTABLE' },
  },
});

registry.registerPath({
  ...secured,
  method: 'post',
  path: '/admin/care-homes/{id}/invite/resend',
  summary: 'Resend the care admin invite; old link stops working (carehome:write)',
  request: { params: carehomeIdParamSchema },
  responses: {
    200: { description: 'Invite re-sent' },
    ...errors,
    409: { description: 'ALREADY_ACTIVATED' },
    429: { description: 'RATE_LIMITED (3 per hour)' },
  },
});

registry.registerPath({
  ...secured,
  method: 'delete',
  path: '/admin/care-homes/{id}/invite',
  summary: 'Cancel a pending invite and remove the never-activated home (carehome:write)',
  request: { params: carehomeIdParamSchema },
  responses: { 200: { description: 'Invite cancelled' }, ...errors, 409: { description: 'ALREADY_ACTIVATED' } },
});

registry.registerPath({
  ...secured,
  method: 'post',
  path: '/admin/care-homes/{id}/deactivate',
  summary: 'Deactivate a care home (carehome:activity)',
  description:
    'Blocked while the home has open orders (NEW, PENDING_DELIVERY, IN_PROGRESS). Revokes care staff sessions, voids pending invites, and notifies the care home and its guardians after commit.',
  request: {
    params: carehomeIdParamSchema,
    body: { content: { 'application/json': { schema: deactivateCarehomeSchema } } },
  },
  responses: {
    200: { description: 'Care home deactivated' },
    ...errors,
    409: { description: 'CARE_HOME_HAS_OPEN_ORDERS (details.openOrderCount, details.orders) | ALREADY_DEACTIVATED | INVALID_TRANSITION' },
  },
});

registry.registerPath({
  ...secured,
  method: 'post',
  path: '/admin/care-homes/{id}/activate',
  summary: 'Reactivate a deactivated care home (carehome:activity)',
  description: 'Status is recomputed (never forced to Active) and the 180-day activity clock is reset.',
  request: {
    params: carehomeIdParamSchema,
    body: { content: { 'application/json': { schema: activateCarehomeSchema } } },
  },
  responses: {
    200: { description: 'Care home reactivated' },
    ...errors,
    409: { description: 'ALREADY_ACTIVE | INVALID_TRANSITION' },
  },
});

registry.registerPath({
  ...secured,
  method: 'post',
  path: '/admin/care-homes/{id}/mark-inactive',
  summary: 'Manually mark an active care home inactive (carehome:activity)',
  request: {
    params: carehomeIdParamSchema,
    body: { content: { 'application/json': { schema: markCarehomeInactiveSchema } } },
  },
  responses: {
    200: { description: 'Marked inactive' },
    ...errors,
    409: { description: 'ALREADY_INACTIVE | INVALID_TRANSITION | VERSION_CONFLICT' },
  },
});

registry.registerPath({
  ...secured,
  method: 'post',
  path: '/admin/care-homes/{id}/mark-active',
  summary: 'Mark an inactive care home active and reset its activity clock (carehome:activity)',
  request: {
    params: carehomeIdParamSchema,
    body: { content: { 'application/json': { schema: markCarehomeActiveSchema } } },
  },
  responses: {
    200: { description: 'Marked active' },
    ...errors,
    409: { description: 'ALREADY_ACTIVE | INVALID_TRANSITION | VERSION_CONFLICT' },
  },
});

type Handler = (req: AdminAuthedRequest) => Promise<unknown>;

function handle(handler: Handler, status = 200) {
  return async (req: AdminAuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await handler(req));
    } catch (err) {
      next(err);
    }
  };
}

const id = (req: AdminAuthedRequest) => String(req.params.id);
const actor = (req: AdminAuthedRequest) => req.adminAuth!.sub;

export const adminCarehomesRouter = Router();

adminCarehomesRouter.get(
  '/care-homes',
  requireAdminPermission('carehome:read'),
  validateQuery(listCarehomesQuerySchema),
  handle((req) => listCarehomes((req as RequestWithValidatedQuery<ListCarehomesQuery>).validatedQuery!)),
);

adminCarehomesRouter.post(
  '/care-homes',
  requireAdminPermission('carehome:write'),
  validateBody(createCarehomeSchema),
  handle((req) => createCarehome(req.body, actor(req)), 201),
);

adminCarehomesRouter.get(
  '/care-homes/:id',
  requireAdminPermission('carehome:read'),
  handle((req) => getCarehomeProfile(id(req), actor(req))),
);

adminCarehomesRouter.get(
  '/care-homes/:id/rooms',
  requireAdminPermission('carehome:read'),
  validateQuery(listCarehomeRoomsQuerySchema),
  handle((req) =>
    listCarehomeRooms(id(req), (req as RequestWithValidatedQuery<ListCarehomeRoomsQuery>).validatedQuery!),
  ),
);

adminCarehomesRouter.patch(
  '/care-homes/:id',
  requireAdminPermission('carehome:write'),
  validateBody(updateCarehomeSchema),
  handle((req) => updateCarehome(id(req), req.body, actor(req))),
);

adminCarehomesRouter.post(
  '/care-homes/:id/invite/resend',
  requireAdminPermission('carehome:write'),
  handle((req) => resendCarehomeInvite(id(req), actor(req))),
);

adminCarehomesRouter.delete(
  '/care-homes/:id/invite',
  requireAdminPermission('carehome:write'),
  handle((req) => cancelCarehomeInvite(id(req), actor(req))),
);

adminCarehomesRouter.post(
  '/care-homes/:id/deactivate',
  requireAdminPermission('carehome:activity'),
  validateBody(deactivateCarehomeSchema),
  handle((req) => deactivateCarehome(id(req), req.body, actor(req))),
);

adminCarehomesRouter.post(
  '/care-homes/:id/activate',
  requireAdminPermission('carehome:activity'),
  validateBody(activateCarehomeSchema),
  handle((req) => activateCarehome(id(req), req.body, actor(req))),
);

adminCarehomesRouter.post(
  '/care-homes/:id/mark-inactive',
  requireAdminPermission('carehome:activity'),
  validateBody(markCarehomeInactiveSchema),
  handle((req) => markCarehomeInactive(id(req), req.body, actor(req))),
);

adminCarehomesRouter.post(
  '/care-homes/:id/mark-active',
  requireAdminPermission('carehome:activity'),
  validateBody(markCarehomeActiveSchema),
  handle((req) => markCarehomeActive(id(req), req.body, actor(req))),
);
