import { readFileSync, existsSync, mkdirSync, chmodSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { IonosJwtPayload, IonosJwtHeader } from './types/ionos.js';

// Everything this process creates (workspace folders, db files, key file) is owner-only.
process.umask(0o077);

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The .env file this app reads (and, on a brand-new install, appends ENCRYPTION_KEY to). */
export function dotEnvFile(): string {
  return process.env.DOTENV_PATH || resolve(__dirname, '..', '..', '.env');
}

function loadEnv(): Record<string, string> {
  if (process.env.NO_DOTENV === '1') return {};
  const envPath = dotEnvFile();
  const env: Record<string, string> = {};
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      env[key] = value;
    }
  }
  return env;
}

export function decodeJwtPayload(token: string): IonosJwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

export function decodeJwtHeader(token: string): IonosJwtHeader {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const header = Buffer.from(parts[0], 'base64url').toString('utf-8');
  return JSON.parse(header);
}

class Config {
  private encryptionKey: string = '';
  readonly port: number;
  readonly host: string;
  /** The pre-workspace shared database (1.x). Only read once, by the startup migration. */
  readonly legacyDbPath: string;
  readonly dataDir: string;
  readonly projectRoot: string;
  readonly proxySecret: string;
  readonly envEncryptionKey: string;
  readonly dotEnvPath: string;

  constructor() {
    const env = loadEnv();
    // Populate process.env with .env file values (actual env vars take precedence)
    for (const [key, value] of Object.entries(env)) {
      if (!(key in process.env)) process.env[key] = value;
    }
    const processEnv = { ...env, ...process.env };

    this.port = parseInt(processEnv.PORT || '3000', 10);
    this.host = processEnv.HOST || '0.0.0.0';
    this.projectRoot = resolve(__dirname, '..', '..');

    // Shared secret the SSO proxy must send as X-Proxy-Secret. Empty = not enforced.
    this.proxySecret = processEnv.PROXY_SECRET || '';

    this.dataDir = processEnv.DATA_DIR || resolve(__dirname, '..', 'data');
    this.legacyDbPath = join(this.dataDir, 'tokenmanager.db');

    mkdirSync(this.dataDir, { recursive: true });

    // The master key is resolved at startup by resolveMasterKey() (services/master-key.ts).
    this.dotEnvPath = dotEnvFile();
    this.envEncryptionKey = (processEnv.ENCRYPTION_KEY || '').trim();
    if (this.envEncryptionKey && !/^[0-9a-fA-F]{64}$/.test(this.envEncryptionKey)) {
      throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    this.encryptionKey = this.envEncryptionKey;
  }

  /** Restrict the data directory and its direct children to the current user (folders 0700, files 0600). */
  hardenDataDir(): void {
    try {
      chmodSync(this.dataDir, 0o700);
      for (const f of readdirSync(this.dataDir)) {
        if (f === '.gitkeep') continue;
        const p = join(this.dataDir, f);
        try { chmodSync(p, statSync(p).isDirectory() ? 0o700 : 0o600); } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn('[Config] Could not restrict data directory permissions:', err instanceof Error ? err.message : err);
    }
  }

  hasEncryptionKey(): boolean {
    return this.encryptionKey.length === 64;
  }

  getEncryptionKey(): Buffer {
    if (!this.hasEncryptionKey()) throw new Error('Master key not loaded yet (resolved at startup)');
    return Buffer.from(this.encryptionKey, 'hex');
  }

  setEncryptionKey(hex: string): void {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Encryption key must be 64 hex characters');
    this.encryptionKey = hex;
  }
}

export const config = new Config();
