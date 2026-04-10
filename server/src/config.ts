import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { IonosJwtPayload, IonosJwtHeader } from './types/ionos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

function loadEnv(): Record<string, string> {
  const envPath = resolve(PROJECT_ROOT, '.env');
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

function decodeJwtPayload(token: string): IonosJwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

function decodeJwtHeader(token: string): IonosJwtHeader {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const header = Buffer.from(parts[0], 'base64url').toString('utf-8');
  return JSON.parse(header);
}

class Config {
  private adminToken: string;
  private encryptionKey: string;
  readonly port: number;
  readonly host: string;
  readonly dbPath: string;
  readonly projectRoot: string;
  readonly contractNumber: number;
  readonly userId: string;
  readonly tokenId: string;
  readonly tokenIssuedAt: Date;
  readonly tokenExpiresAt: Date;

  constructor() {
    const env = loadEnv();
    const processEnv = { ...env, ...process.env };

    // Admin token
    this.adminToken = processEnv.IONOS_API_TOKEN || '';
    if (!this.adminToken) {
      throw new Error('IONOS_API_TOKEN is required in .env');
    }

    // Decode JWT to extract metadata
    const payload = decodeJwtPayload(this.adminToken);
    const header = decodeJwtHeader(this.adminToken);
    this.contractNumber = payload.identity.contractNumber;
    this.userId = payload.identity.uuid;
    this.tokenId = header.kid;
    this.tokenIssuedAt = new Date(payload.iat * 1000);
    this.tokenExpiresAt = new Date(payload.exp * 1000);

    // Encryption key
    this.encryptionKey = processEnv.ENCRYPTION_KEY || '';
    if (!this.encryptionKey) {
      console.log('No ENCRYPTION_KEY found. Generating one...');
      this.encryptionKey = randomBytes(32).toString('hex');
      // Append to .env file
      const envPath = resolve(PROJECT_ROOT, '.env');
      const existing = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
      const newLine = existing.endsWith('\n') ? '' : '\n';
      writeFileSync(envPath, `${existing}${newLine}ENCRYPTION_KEY=${this.encryptionKey}\n`);
      console.log(`ENCRYPTION_KEY has been written to .env. Back up this key!`);
    }
    if (this.encryptionKey.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }

    // Server config
    this.port = parseInt(processEnv.PORT || '3001', 10);
    this.host = processEnv.HOST || '127.0.0.1';
    this.dbPath = resolve(__dirname, '..', 'data', 'tokenmanager.db');
    this.projectRoot = PROJECT_ROOT;
  }

  getAdminToken(): string {
    return this.adminToken;
  }

  setAdminToken(token: string): void {
    this.adminToken = token;
  }

  getEncryptionKey(): Buffer {
    return Buffer.from(this.encryptionKey, 'hex');
  }
}

export const config = new Config();
export { decodeJwtPayload, decodeJwtHeader };
