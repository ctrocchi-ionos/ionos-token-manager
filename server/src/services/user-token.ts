import * as db from '../db/queries.js';
import { decrypt } from './crypto.js';
import { AppError } from '../middleware/error-handler.js';

export function isConfiguredFor(email: string): boolean {
  return !!db.getUserAdminToken(email);
}

export function getAdminTokenFor(email: string): string {
  const row = db.getUserAdminToken(email);
  if (!row) {
    throw new AppError(
      'Configure your IONOS API token first via Settings',
      'NOT_CONFIGURED',
      503,
    );
  }
  return decrypt(row.current_token_enc);
}
