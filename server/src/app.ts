import express, { type Request, type Response } from 'express';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { ssoAuth } from './middleware/sso-auth.js';
import { requireCsrfHeader } from './middleware/csrf.js';
import { userRateLimit, userMutationRateLimit } from './middleware/rate-limit.js';
import { securityHeaders } from './middleware/security-headers.js';
import { attachWorkspace } from './middleware/workspace.js';
import dcdAccountRoutes from './routes/dcd-accounts.js';
import tokenRoutes from './routes/tokens.js';
import templateRoutes from './routes/templates.js';
import resourceRoutes from './routes/resources.js';
import auditRoutes from './routes/audit.js';
import accountRoutes from './routes/account.js';
import backupRoutes from './routes/backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const publicDir = process.env.PUBLIC_DIR || resolve(__dirname, '..', '..', 'public');

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(requestLogger);

  // Platform health check: unauthenticated, no details. Path and body must not change (the platform expects
  // dbConnected; workspaces open per user, so it only says the process is up and serving).
  app.get('/api/admin/health', (_req: Request, res: Response) => {
    res.json({ success: true, data: { status: 'ok', dbConnected: true } });
  });

  // Every other API call: identity -> CSRF -> per-user limits -> the user's private workspace
  app.use('/api', ssoAuth, requireCsrfHeader, userRateLimit, userMutationRateLimit, attachWorkspace);

  app.get('/api/me', (req: Request, res: Response) => {
    res.json({ success: true, data: { email: req.user.email } });
  });

  // Bodies are read only after sign-in. Backup routes come first: the restore upload parses its own,
  // larger body (routes/backup.ts); every other route gets the 1mb limit. Routing decides, not a path string.
  app.use('/api/backup', backupRoutes);
  app.use('/api', express.json({ limit: '1mb' }));

  app.use('/api/dcd-accounts', dcdAccountRoutes);
  app.use('/api/tokens', tokenRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/resources', resourceRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/account', accountRoutes);

  // Unknown API paths get JSON, never the SPA's index.html
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Unknown API route' } });
  });

  if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get('*', (_req, res) => {
      res.sendFile(resolve(publicDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
