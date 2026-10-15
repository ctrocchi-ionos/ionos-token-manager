import { decodeJwtHeader, decodeJwtPayload } from '../config.js';
import { encrypt } from './crypto.js';
import * as db from '../db/queries.js';
import * as ionosCloud from './ionos-cloud.js';
import { AppError } from '../middleware/error-handler.js';
import axios from 'axios';

export async function configureAdminToken(rawToken: string, ownerEmail: string): Promise<void> {
  let payload;
  let header;
  try {
    payload = decodeJwtPayload(rawToken);
    header = decodeJwtHeader(rawToken);
  } catch {
    throw new AppError('This does not look like an IONOS API token (JWT).', 'INVALID_TOKEN', 400);
  }
  if (!payload.exp || !payload.iat || !payload.identity?.uuid || !payload.identity?.contractNumber) {
    throw new AppError('This token is missing required IONOS fields.', 'INVALID_TOKEN', 400);
  }
  if (payload.exp * 1000 <= Date.now()) {
    throw new AppError('This token has already expired.', 'INVALID_TOKEN', 400);
  }

  // Make sure IONOS actually accepts it before we store it
  try {
    await ionosCloud.verifyToken(rawToken);
  } catch (err) {
    if (axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
      throw new AppError('IONOS rejected this token. Check that it is valid and belongs to an admin.', 'INVALID_TOKEN', 400);
    }
    throw new AppError('Could not reach IONOS to verify the token. Try again.', 'IONOS_UNREACHABLE', 502);
  }

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
