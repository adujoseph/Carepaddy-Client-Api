import { prisma } from '@lib/prisma';
import type { ListAuditLogsQuery } from './audit.schema.js';

export async function listAuditLogs(query: ListAuditLogsQuery) {
  const skip = (query.page - 1) * query.limit;
  const where = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.adminAuditLog.count({ where }),
    prisma.adminAuditLog.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, email: true, name: true } },
      },
    }),
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    data: rows.map((row) => ({
      id: row.id,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      beforeState: row.beforeState,
      afterState: row.afterState,
      createdAt: row.createdAt,
      actor: row.actor,
    })),
  };
}
