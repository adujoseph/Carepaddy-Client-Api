import { z } from '@docs/zod-extend';
import { prisma } from '@lib/prisma';
import { AppError } from '@middleware/error-handler';

export const createFaqSchema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(5000),
  sortOrder: z.number().int().min(0).optional().default(0),
  published: z.boolean().optional().default(true),
});

export const updateFaqSchema = z
  .object({
    question: z.string().trim().min(1).max(500).optional(),
    answer: z.string().trim().min(1).max(5000).optional(),
    sortOrder: z.number().int().min(0).optional(),
    published: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.question !== undefined ||
      value.answer !== undefined ||
      value.sortOrder !== undefined ||
      value.published !== undefined,
    { message: 'At least one field is required' },
  );

export const listFaqsQuerySchema = z.object({
  published: z
    .enum(['true', 'false', 'all'])
    .optional()
    .default('true'),
});

export type CreateFaqInput = z.infer<typeof createFaqSchema>;
export type UpdateFaqInput = z.infer<typeof updateFaqSchema>;
export type ListFaqsQuery = z.infer<typeof listFaqsQuerySchema>;

function serializeFaq(faq: {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: faq.id,
    question: faq.question,
    answer: faq.answer,
    sortOrder: faq.sortOrder,
    published: faq.published,
    createdAt: faq.createdAt,
    updatedAt: faq.updatedAt,
  };
}

function publishedFilter(query: ListFaqsQuery) {
  if (query.published === 'all') return {};
  return { published: query.published === 'true' };
}

export async function listFaqs(query: ListFaqsQuery) {
  const rows = await prisma.faq.findMany({
    where: publishedFilter(query),
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return { data: rows.map(serializeFaq) };
}

export async function getFaq(id: string, options?: { publicOnly?: boolean }) {
  const faq = await prisma.faq.findUnique({ where: { id } });
  if (!faq || (options?.publicOnly && !faq.published)) {
    throw new AppError(404, 'FAQ not found', 'NOT_FOUND');
  }
  return serializeFaq(faq);
}

export async function createFaq(input: CreateFaqInput) {
  const faq = await prisma.faq.create({
    data: {
      question: input.question.trim(),
      answer: input.answer.trim(),
      sortOrder: input.sortOrder,
      published: input.published,
    },
  });
  return serializeFaq(faq);
}

export async function updateFaq(id: string, input: UpdateFaqInput) {
  const existing = await prisma.faq.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'FAQ not found', 'NOT_FOUND');
  }

  const faq = await prisma.faq.update({
    where: { id },
    data: {
      ...(input.question !== undefined ? { question: input.question.trim() } : {}),
      ...(input.answer !== undefined ? { answer: input.answer.trim() } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.published !== undefined ? { published: input.published } : {}),
    },
  });
  return serializeFaq(faq);
}

export async function deleteFaq(id: string) {
  const existing = await prisma.faq.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'FAQ not found', 'NOT_FOUND');
  }
  await prisma.faq.delete({ where: { id } });
  return { message: 'FAQ deleted' };
}
