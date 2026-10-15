import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import * as db from '../db/queries.js';

/** Only emails listed in ADMIN_EMAILS may use backup/restore. Empty list = disabled for everyone. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // In local dev (`npm run dev`) the dev identity counts as admin so backup/restore can be tried.
  const isDevUser = process.env.ALLOW_DEV_AUTH === '1' && !!process.env.DEV_AUTH_EMAIL
    && req.user.email === process.env.DEV_AUTH_EMAIL.trim().toLowerCase();
  if (!isDevUser && !config.adminEmails.includes(req.user.email)) {
    db.insertAuditLog({
      action: 'auth.denied',
      entityType: 'admin',
      entityId: req.path,
      actorEmail: req.user.email,
      success: false,
      errorMessage: 'Not an instance admin',
    });
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: config.adminEmails.length === 0
          ? 'Backup and restore are disabled. Set ADMIN_EMAILS to enable them.'
          : 'Only instance admins can do this.',
      },
    });
    return;
  }
  next();
}
