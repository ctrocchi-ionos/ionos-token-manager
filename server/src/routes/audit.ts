import { Router, type Request, type Response } from 'express';
import * as db from '../db/queries.js';
import type { AuditLogResponse } from '../types/app.js';

const router = Router();

function entryToResponse(e: ReturnType<typeof db.listAuditLog>['items'][0]): AuditLogResponse {
  return {
    id: e.id,
    action: e.action,
    entityType: e.entity_type,
    entityId: e.entity_id,
    details: e.details ? JSON.parse(e.details) : null,
    ionosRequestIds: e.ionos_request_ids ? JSON.parse(e.ionos_request_ids) : null,
    success: e.success === 1,
    errorMessage: e.error_message,
    createdAt: e.created_at,
  };
}

// List audit log entries
router.get('/', (req: Request, res: Response) => {
  const { action, entityType, from, to, page, limit } = req.query;
  const result = db.listAuditLog({
    action: action as string | undefined,
    entityType: entityType as string | undefined,
    from: from as string | undefined,
    to: to as string | undefined,
    page: page ? parseInt(page as string, 10) : undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
    actorEmail: req.user.email,
  });

  res.json({
    success: true,
    data: result.items.map(entryToResponse),
    pagination: {
      total: result.total,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 50,
    },
  });
});

// Export audit log
router.get('/export', (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'json';
  const result = db.listAuditLog({ limit: 100000, actorEmail: req.user.email });
  const entries = result.items.map(entryToResponse);

  if (format === 'csv') {
    const headers = 'ID,Action,Entity Type,Entity ID,Success,Error,Created At\n';
    const rows = entries.map((e) =>
      `${e.id},"${e.action}","${e.entityType ?? ''}","${e.entityId ?? ''}",${e.success},"${e.errorMessage ?? ''}","${e.createdAt}"`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-log.csv');
    res.send(headers + rows);
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-log.json');
    res.json({ success: true, data: entries });
  }
});

export default router;
