import express, { Router, type Request, type Response } from 'express';
import { writeFileSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import * as adminRenewal from '../services/admin-renewal.js';
import { isConfiguredFor } from '../services/user-token.js';
import { backupDatabase, replaceDatabase } from '../db/connection.js';
import { initializeDatabase } from '../db/schema.js';
import * as db from '../db/queries.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { join } from 'path';
import { requireAdmin } from '../middleware/require-admin.js';
import { AppError } from '../middleware/error-handler.js';

const router = Router();

// Setup check — per-user: requires authentication
router.get('/needs-setup', (req: Request, res: Response) => {
  res.json({ success: true, data: { needsSetup: !isConfiguredFor(req.user.email) } });
});

// Initial setup — stores the IONOS admin token for this user
router.post('/setup', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body ?? {};
  if (!token || typeof token !== 'string' || token.trim() === '') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'token is required' },
    });
    return;
  }

  await adminRenewal.configureAdminToken(token.replace(/\s+/g, ''), req.user.email);
  res.json({ success: true, data: { message: 'Admin token configured successfully' } });
}));

// Update the admin token (works even when already configured)
router.put('/token', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body ?? {};
  if (!token || typeof token !== 'string' || token.trim() === '') {
    res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'token is required' } });
    return;
  }
  await adminRenewal.configureAdminToken(token.replace(/\s+/g, ''), req.user.email);
  res.json({ success: true, data: { message: 'Admin token updated successfully' } });
}));

// Health check — generic, no token details (SSO-exempt endpoint)
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      dbConnected: true,
    },
  });
});

// Get admin token status — per-user
router.get('/token-status', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: adminRenewal.getAdminTokenStatus(req.user.email),
  });
});

// Download a consistent snapshot of the database
router.get('/backup/db', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const tmpPath = join(config.dataDir, `tokenmanager-backup-${randomUUID()}.db`);
  await backupDatabase(tmpPath);
  db.insertAuditLog({ action: 'admin.backup_db', entityType: 'admin', actorEmail: req.user.email });
  const date = new Date().toISOString().slice(0, 10);
  res.download(tmpPath, `tokenmanager-backup-${date}.db`, (err) => {
    try { unlinkSync(tmpPath); } catch {}
    if (err && !res.headersSent) res.status(500).json({ success: false, error: { code: 'BACKUP_FAILED', message: String(err) } });
  });
}));

// Download the encryption key (served from memory — works regardless of how it was loaded)
router.get('/backup/key', requireAdmin, (req: Request, res: Response) => {
  db.insertAuditLog({ action: 'admin.backup_key', entityType: 'admin', actorEmail: req.user.email });
  const key = config.getEncryptionKey().toString('hex');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="encryption.key"');
  res.send(key);
});

// Restore from backup: { db: base64string, key?: string }
// The global express.json() is bypassed for this route (see index.ts); apply a higher limit here.
router.post('/restore',
  requireAdmin,
  express.json({ limit: '50mb' }),
  asyncHandler(async (req: Request, res: Response) => {
    const { db: dbBase64, key } = req.body ?? {};

    if (!dbBase64) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'db (base64) is required' } });
      return;
    }

    if (key && (typeof key !== 'string' || !/^[0-9a-fA-F]{64}$/.test(key.trim()))) {
      res.status(400).json({ success: false, error: { code: 'INVALID_KEY', message: 'key must be 64 hex characters' } });
      return;
    }

    // Validate and swap the database first, so a bad file never overwrites a working key
    try {
      replaceDatabase(Buffer.from(dbBase64, 'base64'));
    } catch (err) {
      throw new AppError(err instanceof Error ? err.message : 'Invalid database file', 'INVALID_DATABASE', 400);
    }

    initializeDatabase(); // bring an older backup up to the current schema

    if (key) {
      writeFileSync(join(config.dataDir, 'encryption.key'), key.trim(), { mode: 0o600 });
      config.setEncryptionKey(key.trim());
    }
    config.hardenDataDir();

    db.insertAuditLog({ action: 'admin.restore', entityType: 'admin', actorEmail: req.user.email, details: { hasKey: !!key } });

    const warning = key && process.env.ENCRYPTION_KEY
      ? 'ENCRYPTION_KEY env var is set — the restored key file will be ignored on next restart. Update the env var to match the backup key.'
      : undefined;

    res.json({ success: true, data: { message: 'Database restored successfully. Reconfigure your IONOS token if needed. Reload the page.', ...(warning && { warning }) } });
  })
);

export default router;
