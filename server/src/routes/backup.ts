import express, { Router, type Request, type Response } from 'express';
import { rmSync } from 'fs';
import * as q from '../workspace/queries.js';
import { snapshotWorkspace, restoreWorkspace } from '../services/workspace-backup.js';
import { ValidationError } from '../middleware/error-handler.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router = Router();

// My database: a consistent snapshot of the caller's own workspace
router.get('/db', asyncHandler(async (req: Request, res: Response) => {
  q.insertAuditLog(req.ws.db, { action: 'workspace.backup' });
  const { dir, file } = await snapshotWorkspace(req.ws);
  const date = new Date().toISOString().slice(0, 10);
  res.download(file, `tokenmanager-my-backup-${date}.db`, () => rmSync(dir, { recursive: true, force: true }));
}));

// My key: opens only the caller's own data
router.get('/key', (req: Request, res: Response) => {
  q.insertAuditLog(req.ws.db, { action: 'workspace.backup_key' });
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="tokenmanager-my-key.key"');
  res.send(req.ws.key.toString('hex'));
});

// Restore: { db: base64, key: string }. Mounted before the 1mb JSON parser (see app.ts), so this limit applies.
router.post('/restore', express.json({ limit: '50mb' }), (req: Request, res: Response) => {
  const { db, key } = (req.body ?? {}) as { db?: unknown; key?: unknown };
  if (typeof db !== 'string' || !db || typeof key !== 'string') {
    throw new ValidationError('Upload both the backup file and its key file.');
  }
  res.json({ success: true, data: restoreWorkspace(req.ws, Buffer.from(db, 'base64'), key) });
});

export default router;
