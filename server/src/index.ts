import express from 'express';
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
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);
app.use(rateLimit({
  windowMs: 60000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
}));

// API Routes
app.use('/api/tokens', tokenRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/account', accountRoutes);

// Serve frontend in production
const clientDist = resolve(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(resolve(clientDist, 'index.html'));
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
    const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    console.log(`\n[Server] Listening on ${url}`);
    console.log(`[Server] Admin token expires: ${config.tokenExpiresAt.toISOString()}`);
    console.log(`[Server] Contract: ${config.contractNumber}`);
    if (existsSync(clientDist)) {
      console.log(`[Server] Serving frontend from ${clientDist}`);
    } else {
      console.log(`[Server] No frontend build found. Run 'npm run build -w client' to build.`);
    }
    console.log('');

    // Auto-open browser
    const openCmd = process.platform === 'darwin' ? 'open' :
                    process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${openCmd} ${url}`, () => {});
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
