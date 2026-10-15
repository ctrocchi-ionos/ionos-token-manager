import { existsSync, readFileSync } from 'fs';
import { exec } from 'child_process';
import { config } from './config.js';
import { assertSafeAuthConfig } from './middleware/sso-auth.js';
import { startExpiredSweep } from './services/expired-sweep.js';
import { resolveMasterKey, verifyMasterKey, recordMasterKey } from './services/master-key.js';
import { migrateLegacyDatabase } from './workspace/migrate-legacy.js';
import { closeAllWorkspaces } from './workspace/registry.js';
import { createApp, publicDir } from './app.js';

async function main() {
  console.log('='.repeat(60));
  console.log('  IONOS Token Manager');
  console.log('='.repeat(60));

  assertSafeAuthConfig();
  config.hardenDataDir();

  // Master key: from .env, else the old key file, else generated on a brand-new install
  const { key, source } = resolveMasterKey({ envKey: config.envEncryptionKey, dataDir: config.dataDir, dotEnvPath: config.dotEnvPath });
  config.setEncryptionKey(key);
  verifyMasterKey(key, config.dataDir); // a different key than the data was created with: stop, change nothing
  migrateLegacyDatabase(); // a key that cannot read the old data: stop, change nothing
  recordMasterKey(key, config.dataDir);
  console.log(`[MasterKey] Key source: ${source}`);
  const keyFile = `${config.dataDir}/encryption.key`;
  if (source === 'env' && existsSync(keyFile)) {
    // The generator keeps this file on purpose, as a safety copy of the key in .env. Say so, and flag a stale copy.
    if (readFileSync(keyFile, 'utf-8').trim() === key) {
      console.log('[MasterKey] DATA_DIR/encryption.key is kept as a safety copy of ENCRYPTION_KEY (same value). The app uses ENCRYPTION_KEY.');
    } else {
      console.warn('[MasterKey] DATA_DIR/encryption.key differs from ENCRYPTION_KEY, so it is not a valid safety copy. '
        + 'The app uses ENCRYPTION_KEY; put the same value in the file, and keep a copy somewhere safe.');
    }
  }

  config.hardenDataDir();
  startExpiredSweep();

  if (!config.proxySecret) {
    console.warn('[Security] PROXY_SECRET is not set: any client that can reach this port can claim any identity via X-Auth-Email. Bind to localhost or set PROXY_SECRET behind your SSO proxy.');
  }
  if (process.env.DEV_AUTH_EMAIL && process.env.ALLOW_DEV_AUTH !== '1') {
    console.warn('[Security] DEV_AUTH_EMAIL is set but ignored (only used by `npm run dev`).');
  }
  if (process.env.ALLOW_DEV_AUTH === '1' && !['127.0.0.1', 'localhost'].includes(config.host)) {
    console.warn(`[Security] Dev login is on and the app listens on ${config.host}: anyone on your network who reaches port ${config.port} `
      + 'is treated as DEV_AUTH_EMAIL. Add HOST=127.0.0.1 to .env to keep it on this machine.');
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
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
