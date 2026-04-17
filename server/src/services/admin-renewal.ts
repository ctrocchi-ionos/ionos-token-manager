import { decodeJwtHeader, decodeJwtPayload } from '../config.js';
import { encrypt } from './crypto.js';
import * as db from '../db/queries.js';

export async function configureAdminToken(rawToken: string, ownerEmail: string): Promise<void> {
  const payload = decodeJwtPayload(rawToken);
  const header = decodeJwtHeader(rawToken);

  db.upsertUserAdminToken(ownerEmail, {
    currentTokenEnc: encrypt(rawToken),
    tokenId: header.kid,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  });

  db.insertAuditLog({
    action: 'admin.configure',
    entityType: 'admin',
    actorEmail: ownerEmail,
    details: {
      tokenId: header.kid,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    },
  });

  console.log(`[AdminToken] Token configured for ${ownerEmail} (expires: ${new Date(payload.exp * 1000).toISOString()})`);
}

export function getAdminTokenStatus(ownerEmail: string): {
  tokenId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  lastUpdatedAt: string | null;
} {
  const state = db.getUserAdminToken(ownerEmail);
  if (!state) {
    return { tokenId: null, issuedAt: null, expiresAt: null, daysRemaining: 0, lastUpdatedAt: null };
  }

  const timeLeft = new Date(state.expires_at).getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.floor(timeLeft / 86400000));

  return {
    tokenId: state.token_id,
    issuedAt: state.issued_at,
    expiresAt: state.expires_at,
    daysRemaining,
    lastUpdatedAt: state.updated_at,
  };
}
