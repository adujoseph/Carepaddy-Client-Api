import { Router } from 'express';
import { z } from '@docs/zod-extend';
import { requireAuth } from '@middleware/auth';
import { requireRoles } from '@middleware/roles';
import { validateBody, validateQuery } from '@middleware/validate';
import { registry } from '@docs/registry';
import {
  createFaqSchema,
  listFaqsQuerySchema,
  updateFaqSchema,
} from './faq.service.js';
import {
  createFaqController,
  deleteFaqController,
  getFaqController,
  listFaqsController,
  updateFaqController,
} from './faq.controller.js';

export const faqRouter = Router();

const idParam = z.object({ id: z.uuid() });

registry.registerPath({
  method: 'get',
  path: '/client/faqs',
  tags: ['FAQ'],
  summary: 'List FAQs (public)',
  request: { query: listFaqsQuerySchema },
  responses: { 200: { description: 'FAQ list' } },
});

registry.registerPath({
  method: 'get',
  path: '/client/faqs/{id}',
  tags: ['FAQ'],
  summary: 'Get a published FAQ by id (public)',
  request: { params: idParam },
  responses: {
    200: { description: 'FAQ item' },
    404: { description: 'Not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client/faqs',
  tags: ['FAQ'],
  summary: 'Create an FAQ (care_admin)',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: createFaqSchema } } },
  },
  responses: {
    201: { description: 'FAQ created' },
    403: { description: 'Forbidden' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/client/faqs/{id}',
  tags: ['FAQ'],
  summary: 'Update an FAQ (care_admin)',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: updateFaqSchema } } },
  },
  responses: {
    200: { description: 'FAQ updated' },
    404: { description: 'Not found' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/client/faqs/{id}',
  tags: ['FAQ'],
  summary: 'Delete an FAQ (care_admin)',
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: { description: 'FAQ deleted' },
    404: { description: 'Not found' },
  },
});

faqRouter.get('/faqs', validateQuery(listFaqsQuerySchema), listFaqsController);
faqRouter.get('/faqs/:id', getFaqController);
faqRouter.post(
  '/faqs',
  requireAuth,
  requireRoles('care_admin'),
  validateBody(createFaqSchema),
  createFaqController,
);
faqRouter.put(
  '/faqs/:id',
  requireAuth,
  requireRoles('care_admin'),
  validateBody(updateFaqSchema),
  updateFaqController,
);
faqRouter.delete(
  '/faqs/:id',
  requireAuth,
  requireRoles('care_admin'),
  deleteFaqController,
);
