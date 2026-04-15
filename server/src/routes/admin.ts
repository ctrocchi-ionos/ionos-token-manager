import express, { Router, type Request, type Response } from 'express';
import { writeFileSync, unlinkSync } from 'fs';
import { config } from '../config.js';
import * as adminRenewal from '../services/admin-renewal.js';
import { backupDatabase, replaceDatabase } from '../db/connection.js';
import * as db from '../db/queries.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { join } from 'path';

const router = Router();

// Setup check — always available, even before the app is configured
router.get('/needs-setup', (_req: Request, res: Response) => {
  res.json({ success: true, data: { needsSetup: !config.isConfigured } });
});

// Initial setup — stores the IONOS admin token for the first time
router.post('/setup', asyncHandler(async (req: Request, res: Response) => {
  if (config.isConfigured) {
    res.status(400).json({
      success: false,
      error: { code: 'ALREADY_CONFIGURED', message: 'Admin token is already configured' },
    });
    return;
  }

  const { token } = req.body ?? {};
  if (!token || typeof token !== 'string' || token.trim() === '') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: 'token is required' },
    });
    return;
  }

  await adminRenewal.configureAdminToken(token.replace(/\s+/g, ''));
  res.json({ success: true, data: { message: 'Admin token configured successfully' } });
}));

// Update the admin token (works even when already configured)
router.put('/token', asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body ?? {};
  if (!token || typeof token !== 'string' || token.trim() === '') {
    res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'token is required' } });
    return;
  }
  await adminRenewal.configureAdminToken(token.replace(/\s+/g, ''));
  res.json({ success: true, data: { message: 'Admin token updated successfully' } });
}));

// Health check
router.get('/health', (_req: Request, res: Response) => {
  const tokenStatus = adminRenewal.getAdminTokenStatus();
  res.json({
    success: true,
    data: {
      status: 'ok',
      tokenStatus,
      dbConnected: true,
    },
  });
});

// Get admin token status
router.get('/token-status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: adminRenewal.getAdminTokenStatus(),
  });
});

// Download a consistent snapshot of the database
router.get('/backup/db', asyncHandler(async (_req: Request, res: Response) => {
  const tmpPath = join(config.dataDir, 'tokenmanager-backup.db');
  await backupDatabase(tmpPath);
  const date = new Date().toISOString().slice(0, 10);
  res.download(tmpPath, `tokenmanager-backup-${date}.db`, (err) => {
    try { unlinkSync(tmpPath); } catch {}
    if (err && !res.headersSent) res.status(500).json({ success: false, error: { code: 'BACKUP_FAILED', message: String(err) } });
  });
}));

// Download the encryption key (served from memory — works regardless of how it was loaded)
router.get('/backup/key', (_req: Request, res: Response) => {
  const key = config.getEncryptionKey().toString('hex');
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="encryption.key"');
  res.send(key);
});

// Restore from backup: { db: base64string, key?: string }
// The global express.json() is bypassed for this route (see index.ts); apply a higher limit here.
router.post('/restore',
  express.json({ limit: '50mb' }),
  asyncHandler(async (req: Request, res: Response) => {
    const { db: dbBase64, key } = req.body ?? {};

    if (!dbBase64) {
      res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'db (base64) is required' } });
      return;
    }

    // Apply new encryption key first (if provided) so the restored DB can be decrypted
    if (key) {
      if (typeof key !== 'string' || key.trim().length !== 64) {
        res.status(400).json({ success: false, error: { code: 'INVALID_KEY', message: 'key must be 64 hex characters' } });
        return;
      }
      writeFileSync(join(config.dataDir, 'encryption.key'), key.trim());
      config.setEncryptionKey(key.trim());
    }

    const dbBuffer = Buffer.from(dbBase64, 'base64');
    replaceDatabase(dbBuffer);

    // Reload admin token from the restored DB using the (possibly new) encryption key
    const tokenLoaded = adminRenewal.bootstrapAdminToken();
    if (!tokenLoaded) {
      res.status(500).json({
        success: false,
        error: {
          code: 'RESTORE_INCOMPLETE',
          message: 'Database restored but the admin token could not be decrypted. Reconfigure the token via the setup page.',
        },
      });
      return;
    }

    db.insertAuditLog({ action: 'admin.restore', entityType: 'admin', details: { hasKey: !!key } });

    const warning = key && process.env.ENCRYPTION_KEY
      ? 'ENCRYPTION_KEY env var is set — the restored key file will be ignored on next restart. Update the env var to match the backup key.'
      : undefined;

    res.json({ success: true, data: { message: 'Database restored successfully. Reload the page.', ...(warning && { warning }) } });
  })
);

export default router;
