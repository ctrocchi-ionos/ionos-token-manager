import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { IonosJwtPayload, IonosJwtHeader } from './types/ionos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '..', '..', '.env');
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
  readonly dbPath: string;
  readonly dataDir: string;
  readonly projectRoot: string;

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

    this.dataDir = processEnv.DATA_DIR || resolve(__dirname, '..', 'data');
    this.dbPath = join(this.dataDir, 'tokenmanager.db');

    mkdirSync(this.dataDir, { recursive: true });

    const keyFile = join(this.dataDir, 'encryption.key');
    this.encryptionKey = processEnv.ENCRYPTION_KEY || '';

    if (!this.encryptionKey && existsSync(keyFile)) {
      this.encryptionKey = readFileSync(keyFile, 'utf-8').trim();
    }

    if (!this.encryptionKey) {
      this.encryptionKey = randomBytes(32).toString('hex');
      writeFileSync(keyFile, this.encryptionKey, 'utf-8');
      console.warn('\n' + '!'.repeat(60));
      console.warn('  AUTO-GENERATED ENCRYPTION KEY');
      console.warn(`  Saved to: ${keyFile}`);
      console.warn('  BACK UP THIS FILE — losing it means losing access');
      console.warn('  to all tokens stored in the database!');
      console.warn('!'.repeat(60) + '\n');
    }

    if (this.encryptionKey.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
  }

  getEncryptionKey(): Buffer {
    return Buffer.from(this.encryptionKey, 'hex');
  }

  setEncryptionKey(hex: string): void {
    if (hex.length !== 64) throw new Error('Encryption key must be 64 hex characters');
    this.encryptionKey = hex;
  }
}

export const config = new Config();
