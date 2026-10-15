import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
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
  const tag = Buffer.from(parts[1], 'base64');
  // A short tag would weaken the integrity check: accept only the full 16 bytes we write
  if (tag.length !== AUTH_TAG_LENGTH) throw new Error('Invalid authentication tag');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts[0], 'base64'), { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(parts[2], 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/** Per-workspace key: HKDF-SHA256 of the master key, bound to the workspace id. */
export function deriveWorkspaceKey(masterKey: Buffer, workspaceId: string): Buffer {
  assertKey(masterKey);
  return Buffer.from(hkdfSync('sha256', masterKey, WORKSPACE_KEY_SALT, `workspace:${workspaceId}`, 32));
}
