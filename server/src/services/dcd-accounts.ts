import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { decodeJwtHeader, decodeJwtPayload } from '../config.js';
import { AppError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import * as ionosCloud from './ionos-cloud.js';
import { decryptWith, encryptWith } from './crypto.js';
import * as q from '../workspace/queries.js';
import { isoUtc } from '../lib/time.js';
import type { Workspace } from '../workspace/registry.js';
import type { AccountRow } from '../workspace/types.js';

export interface VerifiedAdminToken {
  raw: string;
  tokenId: string;
  contractNumber: number;
  adminUserId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface DcdAccountResponse {
  id: string;
  label: string;
  contractNumber: number;
  hasToken: boolean;
  tokenId: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  tokensHoldingAccess: number;
  updatedAt: string;
  /** True once the admin token's expiry has passed (daysRemaining alone rounds down to 0 a day early). */
  expired: boolean;
}

const LABEL_MAX = 60;
const NEEDS_TOKEN_SUFFIX = ' (needs token)';

function cleanLabel(label: string | undefined, contractNumber: number): string {
  const s = (label ?? '').trim();
  if (s.length > LABEL_MAX) throw new ValidationError(`Label must be at most ${LABEL_MAX} characters`);
  return s || `Contract ${contractNumber}`;
}

/** Decode, sanity-check, and confirm with IONOS that this admin token works. */
export async function verifyAdminToken(input: string): Promise<VerifiedAdminToken> {
  const raw = input.replace(/\s+/g, '');
  let payload;
  let header;
  try {
    payload = decodeJwtPayload(raw);
    header = decodeJwtHeader(raw);
  } catch {
    throw new AppError('This does not look like an IONOS API token (JWT).', 'INVALID_TOKEN', 400);
  }
  if (!payload.exp || !payload.iat || !payload.identity?.uuid || !payload.identity?.contractNumber || !header.kid) {
    throw new AppError('This token is missing required IONOS fields.', 'INVALID_TOKEN', 400);
  }
  if (payload.exp * 1000 <= Date.now()) {
    throw new AppError('This token has already expired.', 'INVALID_TOKEN', 400);
  }
  try {
    await ionosCloud.verifyToken(raw);
  } catch (err) {
    if (axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
      throw new AppError('IONOS rejected this token. Check that it is valid and belongs to an admin.', 'INVALID_TOKEN', 400);
    }
    throw new AppError('Could not reach IONOS to verify the token. Try again.', 'IONOS_UNREACHABLE', 502);
  }
  return {
    raw,
    tokenId: header.kid,
    contractNumber: payload.identity.contractNumber,
    adminUserId: payload.identity.uuid,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

function tokenFields(ws: Workspace, v: VerifiedAdminToken): q.AccountTokenFields {
  return {
    admin_user_id: v.adminUserId,
    token_enc: encryptWith(ws.key, v.raw),
    token_id: v.tokenId,
    issued_at: v.issuedAt,
    expires_at: v.expiresAt,
  };
}

function mustGet(ws: Workspace, accountId: string): AccountRow {
  const a = q.getAccount(ws.db, accountId);
  if (!a) throw new NotFoundError('DCD account', accountId);
  return a;
}

export async function addAccount(ws: Workspace, label: string | undefined, rawToken: string): Promise<AccountRow> {
  const v = await verifyAdminToken(rawToken);
  const alreadyAdded = (existingLabel: string) => new AppError(
    `Contract ${v.contractNumber} is already added as "${existingLabel}". Use "Replace token" on it instead.`,
    'ACCOUNT_EXISTS', 409,
  );
  const existing = q.getAccountByContract(ws.db, v.contractNumber);
  if (existing) throw alreadyAdded(existing.label);
  const id = uuidv4();
  try {
    q.insertAccount(ws.db, { id, label: cleanLabel(label, v.contractNumber), contract_number: v.contractNumber, ...tokenFields(ws, v) });
  } catch (err) {
    // Added in the meantime by another writer of the same file: the contract number is UNIQUE
    const now = q.getAccountByContract(ws.db, v.contractNumber);
    if (now && (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw alreadyAdded(now.label);
    throw err;
  }
  q.insertAuditLog(ws.db, {
    action: 'account.add', accountId: id, entityType: 'account', entityId: id,
    details: { contractNumber: v.contractNumber, tokenId: v.tokenId, expiresAt: v.expiresAt },
  });
  return mustGet(ws, id);
}

export async function replaceAccountToken(ws: Workspace, accountId: string, rawToken: string): Promise<AccountRow> {
  const account = mustGet(ws, accountId);
  const v = await verifyAdminToken(rawToken);
  if (v.contractNumber !== account.contract_number) {
    throw new ValidationError(
      `This token belongs to contract ${v.contractNumber}, not ${account.contract_number}. Add it as a new account instead.`,
    );
  }
  q.updateAccountToken(ws.db, accountId, tokenFields(ws, v));
  // Placeholder accounts created by the migration lose their "(needs token)" suffix once they have one
  if (account.label.endsWith(NEEDS_TOKEN_SUFFIX)) {
    q.renameAccount(ws.db, accountId, account.label.slice(0, -NEEDS_TOKEN_SUFFIX.length));
  }
  q.insertAuditLog(ws.db, {
    action: 'account.token_replace', accountId, entityType: 'account', entityId: accountId,
    details: { tokenId: v.tokenId, expiresAt: v.expiresAt },
  });
  return mustGet(ws, accountId);
}

export function renameAccountLabel(ws: Workspace, accountId: string, label: string): AccountRow {
  const account = mustGet(ws, accountId);
  const clean = cleanLabel(label, account.contract_number);
  q.renameAccount(ws.db, accountId, clean);
  q.insertAuditLog(ws.db, { action: 'account.rename', accountId, entityType: 'account', entityId: accountId, details: { label: clean } });
  return mustGet(ws, accountId);
}

export function removeAccount(ws: Workspace, accountId: string): void {
  const account = mustGet(ws, accountId);
  q.markExpiredTokens(ws.db, accountId);
  const holding = q.countTokensHoldingIonosAccess(ws.db, accountId);
  if (holding > 0) {
    throw new AppError(
      `${holding} token(s) in "${account.label}" still have IONOS users. Revoke them first.`,
      'ACCOUNT_IN_USE', 409,
    );
  }
  q.deleteAccount(ws.db, accountId);
  q.insertAuditLog(ws.db, {
    action: 'account.remove', accountId, entityType: 'account', entityId: accountId,
    details: { label: account.label, contractNumber: account.contract_number },
  });
}

/** The decrypted IONOS admin token for one of this user's DCD accounts. */
export function getAccountAdminToken(ws: Workspace, accountId: string): string {
  const account = mustGet(ws, accountId);
  if (!account.token_enc) {
    throw new AppError(`"${account.label}" has no API token yet. Add one in Settings.`, 'NOT_CONFIGURED', 503);
  }
  if (account.expires_at && new Date(account.expires_at).getTime() <= Date.now()) {
    throw new AppError(`The API token for "${account.label}" has expired. Replace it in Settings.`, 'ACCOUNT_TOKEN_EXPIRED', 503);
  }
  return decryptWith(ws.key, account.token_enc);
}

export function toAccountResponse(ws: Workspace, a: AccountRow): DcdAccountResponse {
  const msLeft = a.expires_at ? new Date(a.expires_at).getTime() - Date.now() : 0;
  return {
    id: a.id,
    label: a.label,
    contractNumber: a.contract_number,
    hasToken: !!a.token_enc,
    tokenId: a.token_id,
    expiresAt: a.expires_at,
    daysRemaining: Math.max(0, Math.floor(msLeft / 86400000)),
    tokensHoldingAccess: q.countTokensHoldingIonosAccess(ws.db, a.id),
    updatedAt: isoUtc(a.updated_at),
    expired: !!a.expires_at && msLeft <= 0,
  };
}
