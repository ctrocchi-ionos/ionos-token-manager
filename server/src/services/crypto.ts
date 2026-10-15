import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const WORKSPACE_KEY_SALT = 'ionos-token-manager/workspace-key/v1';

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
}

export function encryptWith(key: Buffer, plaintext: string): string {
  assertKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  // Format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted}`;
}

export function decryptWith(key: Buffer, encryptedStr: string): string {
  assertKey(key);
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts[0], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
  let decrypted = decipher.update(parts[2], 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Per-workspace key: HKDF-SHA256 of the master key, bound to the workspace id. */
export function deriveWorkspaceKey(masterKey: Buffer, workspaceId: string): Buffer {
  assertKey(masterKey);
  return Buffer.from(hkdfSync('sha256', masterKey, WORKSPACE_KEY_SALT, `workspace:${workspaceId}`, 32));
}

// Temporary wrappers for code not yet moved to workspaces. Deleted in Task 7.
export function encrypt(plaintext: string): string {
  return encryptWith(config.getEncryptionKey(), plaintext);
}
export function decrypt(encryptedStr: string): string {
  return decryptWith(config.getEncryptionKey(), encryptedStr);
}
