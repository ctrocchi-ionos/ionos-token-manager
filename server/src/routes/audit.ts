import { Router, type Request, type Response } from 'express';
import * as q from '../workspace/queries.js';
import { csvRow } from '../lib/csv.js';
import { parsePaging } from '../lib/paging.js';
import type { AuditRow } from '../workspace/types.js';
import type { AuditLogResponse } from '../types/app.js';

const router = Router();

function entryToResponse(e: AuditRow): AuditLogResponse {
  return {
    id: e.id,
    accountId: e.account_id,
    action: e.action,
    entityType: e.entity_type,
    entityId: e.entity_id,
    details: e.details ? JSON.parse(e.details) : null,
    success: e.success === 1,
    errorMessage: e.error_message,
    createdAt: e.created_at,
  };
}

router.get('/', (req: Request, res: Response) => {
  const { page, limit } = parsePaging(req.query);
  const result = q.listAuditLog(req.ws.db, {
    action: req.query.action as string | undefined,
    entityType: req.query.entityType as string | undefined,
    accountId: req.query.accountId as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    page,
    limit,
  });
  res.json({ success: true, data: result.items.map(entryToResponse), pagination: { total: result.total, page, limit } });
});

router.get('/export', (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'json';
  const entries = q.listAuditLog(req.ws.db, { limit: 100000 }).items.map(entryToResponse);

  if (format === 'csv') {
    const labels = new Map(q.listAccounts(req.ws.db).map((a) => [a.id, a.label]));
    const headers = csvRow(['ID', 'Account', 'Action', 'Entity Type', 'Entity ID', 'Success', 'Error', 'Created At']) + '\n';
    const rows = entries.map((e) => csvRow([
      e.id, e.accountId ? labels.get(e.accountId) ?? e.accountId : '', e.action, e.entityType, e.entityId, e.success, e.errorMessage, e.createdAt,
    ])).join('\n');
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
