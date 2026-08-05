import { Router } from 'express';
import { requireAuth } from '@middleware/auth';
import { registry } from '@docs/registry';
import { listGuardianResidentsController } from './guardian-residents.controller.js';

export const guardianResidentsRouter = Router();

registry.registerPath({
  method: 'get',
  path: '/client/guardian/residents',
  tags: ['Guardian'],
  summary: 'List residents linked to the authenticated guardian',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Resident name, carehome, and room number' },
    401: { description: 'Unauthorized' },
    403: { description: 'Guardian role required' },
  },
});

guardianResidentsRouter.get(
  '/guardian/residents',
  requireAuth,
  listGuardianResidentsController,
);
