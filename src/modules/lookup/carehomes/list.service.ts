import { z } from '@docs/zod-extend';
import { prisma } from '@lib/prisma';

export const listCarehomesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListCarehomesQuery = z.infer<typeof listCarehomesQuerySchema>;

export async function listCarehomes(query: ListCarehomesQuery) {
  const skip = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    prisma.carehome.count({ where: { status: 'active' } }),
    prisma.carehome.findMany({
      where: { status: 'active' },
      orderBy: { name: 'asc' },
      skip,
      take: query.pageSize,
      select: { id: true, name: true },
    }),
  ]);

  return {
    data: rows.map((row) => ({ tenantId: row.id, name: row.name })),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
