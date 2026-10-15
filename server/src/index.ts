import express, { type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initializeDatabase } from './db/schema.js';
import { seedBuiltinTemplates } from './db/queries.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { ssoAuth } from './middleware/sso-auth.js';
import { securityHeaders } from './middleware/security-headers.js';
import { startExpiredSweep } from './services/expired-sweep.js';
import tokenRoutes from './routes/tokens.js';
import templateRoutes from './routes/templates.js';
import resourceRoutes from './routes/resources.js';
import adminRoutes from './routes/admin.js';
import auditRoutes from './routes/audit.js';
import accountRoutes from './routes/account.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');

// Middleware. No CORS: the UI is served from the same origin, so cross-site access stays blocked.
app.use(securityHeaders);
// Skip global body parsing for /api/admin/restore — it sets its own higher limit
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/api/admin/restore') return next();
  express.json({ limit: '1mb' })(req, res, next);
});
app.use(requestLogger);
const rateLimitMessage = { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } };
app.use(rateLimit({
  windowMs: 60000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage,
}));
// Backup / restore / token setup are rare and sensitive: much tighter limit
app.use('/api/admin', rateLimit({
  windowMs: 60000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/needs-setup' || req.path === '/token-status',
  message: rateLimitMessage,
}));

// SSO auth: require X-Auth-Email on all API routes except the platform health check
const SSO_EXEMPT = ['/admin/health'];
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (SSO_EXEMPT.includes(req.path)) return next();
  ssoAuth(req, res, next);
});

// Current user identity
app.get('/api/me', (req: Request, res: Response) => {
  res.json({ success: true, data: { email: req.user.email } });
});

// API Routes
app.use('/api/tokens', tokenRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/account', accountRoutes);

// Serve frontend static files from the public/ directory at project root
const publicDir = process.env.PUBLIC_DIR || resolve(__dirname, '..', '..', 'public');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(resolve(publicDir, 'index.html'));
  });
}

// Error handler (must be last)
app.use(errorHandler);

// Initialize and start
async function main() {
  console.log('='.repeat(60));
  console.log('  IONOS Token Manager');
  console.log('='.repeat(60));

  // Database
  console.log('\n[Init] Initializing database...');
  config.hardenDataDir();
  initializeDatabase();
  seedBuiltinTemplates();
  config.hardenDataDir(); // the db files may only now exist
  startExpiredSweep();

  if (!config.proxySecret) {
    console.warn('[Security] PROXY_SECRET is not set: any client that can reach this port can claim any identity via X-Auth-Email. Bind to localhost or set PROXY_SECRET behind your SSO proxy.');
  }
  if (config.adminEmails.length === 0) {
    console.warn('[Security] ADMIN_EMAILS is not set: backup and restore are disabled.');
  }
  if (process.env.DEV_AUTH_EMAIL && process.env.ALLOW_DEV_AUTH !== '1') {
    console.warn('[Security] DEV_AUTH_EMAIL is set but ignored (only used by `npm run dev`).');
  }
  if (process.env.ENCRYPTION_KEY === undefined) {
    console.warn('[Security] Encryption key is stored next to the database. In production, supply ENCRYPTION_KEY from a secret store instead.');
  }

  // Start server
  app.listen(config.port, config.host, () => {
    const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
    const url = `http://${displayHost}:${config.port}`;
    console.log(`\n[Server] Listening on http://${config.host}:${config.port}`);
    console.log(`[Server] Each user must configure their own IONOS token via ${url}/settings`);

    if (existsSync(publicDir)) {
      console.log(`[Server] Serving frontend from ${publicDir}`);
    } else {
      console.log(`[Server] No frontend build found. Run 'npm run build' to build.`);
    }
    console.log('');

    // Only auto-open browser in development
    if (process.env.NODE_ENV === 'development') {
      const openCmd = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${openCmd} ${url}`, () => {});
    }
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
