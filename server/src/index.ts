import { existsSync } from 'fs';
import { exec } from 'child_process';
import { config } from './config.js';
import { assertSafeAuthConfig } from './middleware/sso-auth.js';
import { startExpiredSweep } from './services/expired-sweep.js';
import { closeAllWorkspaces } from './workspace/registry.js';
import { createApp, publicDir } from './app.js';

async function main() {
  console.log('='.repeat(60));
  console.log('  IONOS Token Manager');
  console.log('='.repeat(60));

  assertSafeAuthConfig();
  config.hardenDataDir();
  startExpiredSweep();

  if (process.env.DEV_AUTH_EMAIL && process.env.ALLOW_DEV_AUTH !== '1') {
    console.warn('[Security] DEV_AUTH_EMAIL is set but ignored (only used by `npm run dev`).');
  }

  const server = createApp().listen(config.port, config.host, () => {
    const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
    const url = `http://${displayHost}:${config.port}`;
    console.log(`\n[Server] Listening on http://${config.host}:${config.port}`);
    console.log(existsSync(publicDir)
      ? `[Server] Serving frontend from ${publicDir}`
      : `[Server] No frontend build found. Run 'npm run build' to build.`);
    if (process.env.NODE_ENV === 'development') {
      const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${openCmd} ${url}`, () => {});
    }
  });

  // Flush SQLite WAL files cleanly when the platform stops the container
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      server.close();
      closeAllWorkspaces();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
