import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { initializeDatabase } from './db/schema.js';
import { seedBuiltinTemplates } from './db/queries.js';
import { bootstrapAdminToken, startAutoRenewal } from './services/admin-renewal.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import tokenRoutes from './routes/tokens.js';
import templateRoutes from './routes/templates.js';
import resourceRoutes from './routes/resources.js';
import adminRoutes from './routes/admin.js';
import auditRoutes from './routes/audit.js';
import accountRoutes from './routes/account.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

// Middleware
app.use(cors());
// Skip global body parsing for /api/admin/restore — it sets its own higher limit
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/api/admin/restore') return next();
  express.json({ limit: '1mb' })(req, res, next);
});
app.use(requestLogger);
app.use(rateLimit({
  windowMs: 60000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
}));

// Guard: block API routes that require a configured token, except setup endpoints
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const allowedWhenUnconfigured = [
    '/admin/needs-setup',
    '/admin/setup',
    '/admin/health',
    '/admin/restore',
  ];
  if (!config.isConfigured && !allowedWhenUnconfigured.includes(req.path)) {
    res.status(503).json({
      success: false,
      error: {
        code: 'NOT_CONFIGURED',
        message: 'App is not configured. Open the web interface to complete setup.',
      },
    });
    return;
  }
  next();
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
  initializeDatabase();
  seedBuiltinTemplates();

  // Admin token
  console.log('[Init] Bootstrapping admin token...');
  bootstrapAdminToken();

  // Auto-renewal
  console.log('[Init] Starting auto-renewal service...');
  startAutoRenewal();

  // Start server
  app.listen(config.port, config.host, () => {
    const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
    const url = `http://${displayHost}:${config.port}`;
    console.log(`\n[Server] Listening on http://${config.host}:${config.port}`);

    if (config.isConfigured) {
      console.log(`[Server] Admin token expires: ${config.tokenExpiresAt.toISOString()}`);
      console.log(`[Server] Contract: ${config.contractNumber}`);
    } else {
      console.log(`[Server] Not configured — open ${url} to complete setup`);
    }

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
