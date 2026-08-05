import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '@middleware/auth';
import type { RequestWithValidatedQuery } from '@middleware/validate';
import {
  createFaq,
  deleteFaq,
  getFaq,
  listFaqs,
  updateFaq,
  type CreateFaqInput,
  type ListFaqsQuery,
  type UpdateFaqInput,
} from './faq.service.js';

export async function listFaqsController(
  req: RequestWithValidatedQuery<ListFaqsQuery>,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await listFaqs(req.validatedQuery!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getFaqController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing FAQ id' } });
      return;
    }
    const result = await getFaq(id, { publicOnly: true });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function createFaqController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const result = await createFaq(req.body as CreateFaqInput);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateFaqController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing FAQ id' } });
      return;
    }
    const result = await updateFaq(id, req.body as UpdateFaqInput);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function deleteFaqController(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing FAQ id' } });
      return;
    }
    const result = await deleteFaq(id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
