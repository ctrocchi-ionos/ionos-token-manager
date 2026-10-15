import { existsSync } from 'fs';
import { exec } from 'child_process';
import { config } from './config.js';
import { initializeDatabase } from './db/schema.js';
import { seedBuiltinTemplates } from './db/queries.js';
import { assertSafeAuthConfig } from './middleware/sso-auth.js';
import { startExpiredSweep } from './services/expired-sweep.js';
import { createApp, publicDir } from './app.js';

async function main() {
  console.log('='.repeat(60));
  console.log('  IONOS Token Manager');
  console.log('='.repeat(60));

  assertSafeAuthConfig();

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

  createApp().listen(config.port, config.host, () => {
    const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
    const url = `http://${displayHost}:${config.port}`;
    console.log(`\n[Server] Listening on http://${config.host}:${config.port}`);
    console.log(`[Server] Each user must configure their own IONOS token via ${url}/settings`);
    console.log(existsSync(publicDir)
      ? `[Server] Serving frontend from ${publicDir}`
      : `[Server] No frontend build found. Run 'npm run build' to build.`);
    console.log('');
    if (process.env.NODE_ENV === 'development') {
      const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${openCmd} ${url}`, () => {});
    }
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
