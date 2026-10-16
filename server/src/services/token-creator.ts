import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { decodeJwtHeader, decodeJwtPayload } from '../config.js';
import { encryptWith, decryptWith } from './crypto.js';
import * as ionosAuth from './ionos-auth.js';
import * as ionosCloud from './ionos-cloud.js';
import * as q from '../workspace/queries.js';
import { getAccountAdminToken } from './dcd-accounts.js';
import { TokenCreationError, AppError, NotFoundError } from '../middleware/error-handler.js';
import { withKeyLock } from '../lib/key-lock.js';
import { isoUtc } from '../lib/time.js';
import type { Workspace } from '../workspace/registry.js';
import type { TokenRow } from '../workspace/types.js';
import type { CreateTokenRequest, CreateTokenResult, ManagedTokenResponse } from '../types/app.js';

class Rollback {
  private steps: Array<{ name: string; fn: () => Promise<void> }> = [];

  add(name: string, fn: () => Promise<void>) {
    this.steps.unshift({ name, fn }); // LIFO
  }

  async execute(): Promise<string[]> {
    const results: string[] = [];
    for (const step of this.steps) {
      try {
        await step.fn();
        results.push(`${step.name}: OK`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        results.push(`${step.name}: FAILED (${msg})`);
        console.error(`Rollback step "${step.name}" failed:`, msg);
      }
    }
    return results;
  }
}

function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
  const bytes = randomBytes(32);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join('');
}

function isNotFound(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown';
}

/** Regenerate, revoke and the expiry sweep take this lock, so they never interleave on one token. */
export function tokenLockKey(ws: Workspace, tokenId: string): string {
  return `token:${ws.id}:${tokenId}`;
}

function mustGetToken(ws: Workspace, id: string): TokenRow {
  const token = q.getManagedTokenById(ws.db, id);
  if (!token) throw new NotFoundError('Token', id);
  return token;
}

export async function createManagedToken(
  ws: Workspace,
  accountId: string,
  adminToken: string,
  req: CreateTokenRequest,
): Promise<CreateTokenResult> {
  const rollback = new Rollback();
  const internalId = uuidv4();
  const shortId = internalId.slice(0, 8);

  // Step 1: Generate credentials
  const contractNumber = decodeJwtPayload(adminToken).identity.contractNumber;
  const email = `tkn-${shortId}@c${contractNumber}.tokenmanager.internal`;
  const password = generatePassword();

  let ionosUserId = '';
  let ionosGroupId = '';

  try {
    // Step 2: Create sub-user
    console.log(`[TokenCreator] Step 2: Creating sub-user ${email}`);
    const user = await ionosCloud.createUser(adminToken, {
      firstname: 'TokenMgr',
      lastname: req.name.slice(0, 50),
      email,
      password,
    });
    ionosUserId = user.id;
    rollback.add('delete-user', () => ionosCloud.deleteUser(adminToken, ionosUserId));

    // Step 3: Create group with permissions
    const groupName = `tkn-${req.name.slice(0, 30).replace(/[^a-zA-Z0-9-_ ]/g, '')}-${shortId}`;
    console.log(`[TokenCreator] Step 3: Creating group ${groupName}`);
    const group = await ionosCloud.createGroup(adminToken, groupName, req.permissions);
    ionosGroupId = group.id;
    rollback.add('delete-group', () => ionosCloud.deleteGroup(adminToken, ionosGroupId));

    // Step 4: Add user to group
    console.log(`[TokenCreator] Step 4: Adding user to group`);
    await ionosCloud.addUserToGroup(adminToken, ionosGroupId, ionosUserId);

    // Step 5: Share resources (if any)
    if (req.sharedResources && req.sharedResources.length > 0) {
      console.log(`[TokenCreator] Step 5: Sharing ${req.sharedResources.length} resources`);
      for (const resource of req.sharedResources) {
        await ionosCloud.shareResourceWithGroup(
          adminToken, ionosGroupId, resource.resourceId, resource.editPrivilege, resource.sharePrivilege,
        );
      }
    }

    // Step 6: Generate token as the sub-user (wait a moment for user propagation)
    console.log(`[TokenCreator] Step 6: Generating token (TTL: ${req.ttlSeconds}s)`);
    await new Promise((r) => setTimeout(r, 3000));
    const tokenJwt = await ionosAuth.generateTokenAsUser(email, password, req.ttlSeconds);
    const ionosTokenId = decodeJwtHeader(tokenJwt).kid;
    const expiresAt = new Date(decodeJwtPayload(tokenJwt).exp * 1000).toISOString();

    // Step 7: Persist to this user's workspace
    console.log(`[TokenCreator] Step 7: Persisting to database`);
    q.insertManagedToken(ws.db, {
      id: internalId,
      account_id: accountId,
      name: req.name,
      description: req.description ?? null,
      ionos_token_id: ionosTokenId,
      ionos_user_id: ionosUserId,
      ionos_group_id: ionosGroupId,
      sub_user_email: email,
      sub_user_password_enc: encryptWith(ws.key, password),
      permissions: JSON.stringify(req.permissions),
      shared_resources: JSON.stringify(req.sharedResources ?? []),
      template_id: req.templateId ?? null,
      ttl_seconds: req.ttlSeconds,
      expires_at: expiresAt,
      status: 'active',
      cleanup_on_delete: req.cleanupOnDelete !== false ? 1 : 0,
    });

    q.insertAuditLog(ws.db, {
      action: 'token.create',
      accountId,
      entityType: 'token',
      entityId: internalId,
      details: {
        name: req.name,
        permissions: req.permissions,
        ttlSeconds: req.ttlSeconds,
        sharedResources: req.sharedResources?.length ?? 0,
        ionosUserId,
        ionosGroupId,
      },
    });

    console.log(`[TokenCreator] Token "${req.name}" created successfully (ID: ${internalId})`);

    return {
      id: internalId,
      accountId,
      name: req.name,
      description: req.description ?? null,
      ionosTokenId,
      ionosUserId,
      ionosGroupId,
      subUserEmail: email,
      permissions: req.permissions,
      sharedResources: req.sharedResources ?? [],
      templateId: req.templateId ?? null,
      ttlSeconds: req.ttlSeconds,
      createdAt: new Date().toISOString(),
      expiresAt,
      lastRegeneratedAt: null,
      status: 'active',
      cleanupOnDelete: req.cleanupOnDelete !== false,
      cleanedUpAt: null,
      tokenValue: tokenJwt,
    };
  } catch (err) {
    const message = errMsg(err);
    console.error(`[TokenCreator] Failed: ${message}`);
    const rollbackResults = await rollback.execute();
    q.insertAuditLog(ws.db, {
      action: 'token.create',
      accountId,
      entityType: 'token',
      entityId: internalId,
      details: { name: req.name, rollbackResults },
      success: false,
      errorMessage: message,
    });
    throw new TokenCreationError(message, 'creation', rollbackResults);
  }
}

export function regenerateToken(ws: Workspace, id: string): Promise<{ tokenValue: string; expiresAt: string }> {
  return withKeyLock(tokenLockKey(ws, id), () => regenerateLocked(ws, id));
}

async function regenerateLocked(ws: Workspace, id: string): Promise<{ tokenValue: string; expiresAt: string }> {
  const token = mustGetToken(ws, id);
  if (token.status === 'revoked') {
    throw new AppError('This token was revoked and cannot be regenerated. Create a new one.', 'VALIDATION_ERROR', 400);
  }
  if (token.cleaned_up_at) {
    throw new AppError('This token expired and its IONOS user was cleaned up automatically. Create a new token.', 'VALIDATION_ERROR', 400);
  }

  const password = decryptWith(ws.key, token.sub_user_password_enc);
  const tokenJwt = await ionosAuth.generateTokenAsUser(token.sub_user_email, password, token.ttl_seconds);
  const newTokenId = decodeJwtHeader(tokenJwt).kid;
  const expiresAt = new Date(decodeJwtPayload(tokenJwt).exp * 1000).toISOString();
  const oldTokenId = token.ionos_token_id;

  if (!q.updateManagedTokenIonosId(ws.db, id, newTokenId, expiresAt)) {
    // The row was revoked, cleaned up, or removed (e.g. a restore) while IONOS was answering: do not leave the new token live
    try {
      await ionosAuth.deleteTokenAsUser(token.sub_user_email, password, newTokenId);
    } catch (err) {
      if (!isNotFound(err)) console.warn(`[TokenCreator] Could not delete the token just generated for ${id}: ${errMsg(err)}`);
    }
    throw new AppError('This token changed while it was being regenerated (revoked or removed). Reload and try again.', 'TOKEN_CHANGED', 409);
  }

  // Best-effort: delete the previous token so it doesn't linger as an orphan
  let oldTokenDeleted = false;
  let oldTokenDeleteError: string | undefined;
  if (oldTokenId) {
    try {
      await ionosAuth.deleteTokenAsUser(token.sub_user_email, password, oldTokenId);
      oldTokenDeleted = true;
    } catch (err) {
      oldTokenDeleteError = errMsg(err);
      console.warn(`[TokenCreator] Failed to delete old token ${oldTokenId} during regenerate: ${oldTokenDeleteError}`);
    }
  }

  q.insertAuditLog(ws.db, {
    action: 'token.regenerate',
    accountId: token.account_id,
    entityType: 'token',
    entityId: id,
    details: { newTokenId, expiresAt, oldTokenId, oldTokenDeleted, oldTokenDeleteError },
  });

  return { tokenValue: tokenJwt, expiresAt };
}

/**
 * Delete the sub-user and group on IONOS (a 404 means "already gone" and counts as success).
 * Returns a list of error messages; empty means everything is gone.
 */
export async function cleanupIonosAccess(token: TokenRow, adminToken: string): Promise<string[]> {
  const errors: string[] = [];
  try {
    await ionosCloud.deleteUser(adminToken, token.ionos_user_id);
  } catch (err) {
    if (!isNotFound(err)) errors.push(`Could not delete sub-user: ${errMsg(err)}`);
  }
  try {
    await ionosCloud.deleteGroup(adminToken, token.ionos_group_id);
  } catch (err) {
    if (!isNotFound(err)) errors.push(`Could not delete group: ${errMsg(err)}`);
  }
  return errors;
}

export function revokeManagedToken(ws: Workspace, id: string): Promise<void> {
  return withKeyLock(tokenLockKey(ws, id), () => revokeLocked(ws, id));
}

async function revokeLocked(ws: Workspace, id: string): Promise<void> {
  const token = mustGetToken(ws, id);
  const errors: string[] = [];

  if (token.cleanup_on_delete) {
    // Deleting the sub-user also removes its S3 keys and invalidates its token on IONOS.
    if (!token.cleaned_up_at) {
      errors.push(...await cleanupIonosAccess(token, getAccountAdminToken(ws, token.account_id)));
    }
  } else if (token.ionos_token_id && token.status !== 'expired') {
    // Cleanup is off: keep the user, but the token itself must stop working.
    try {
      await ionosAuth.deleteTokenAsUser(token.sub_user_email, decryptWith(ws.key, token.sub_user_password_enc), token.ionos_token_id);
    } catch (err) {
      if (!isNotFound(err)) errors.push(`Could not delete the IONOS token: ${errMsg(err)}`);
    }
  }

  if (errors.length > 0) {
    // Do NOT mark it revoked: access may still be live. Keep the row so the user can retry.
    q.insertAuditLog(ws.db, {
      action: 'token.revoke',
      accountId: token.account_id,
      entityType: 'token',
      entityId: id,
      details: { cleanedUp: false, errors },
      success: false,
      errorMessage: errors.join('; '),
    });
    throw new AppError(`Revoke incomplete, the token may still work. ${errors.join('; ')}`, 'REVOKE_INCOMPLETE', 502, { errors });
  }

  q.updateManagedTokenStatus(ws.db, id, 'revoked');
  q.insertAuditLog(ws.db, {
    action: 'token.revoke',
    accountId: token.account_id,
    entityType: 'token',
    entityId: id,
    details: { cleanedUp: token.cleanup_on_delete === 1 },
  });
}

export function tokenToResponse(token: TokenRow): ManagedTokenResponse {
  return {
    id: token.id,
    accountId: token.account_id,
    name: token.name,
    description: token.description,
    ionosTokenId: token.ionos_token_id,
    ionosUserId: token.ionos_user_id,
    ionosGroupId: token.ionos_group_id,
    subUserEmail: token.sub_user_email,
    permissions: JSON.parse(token.permissions),
    sharedResources: JSON.parse(token.shared_resources),
    templateId: token.template_id,
    ttlSeconds: token.ttl_seconds,
    createdAt: isoUtc(token.created_at),
    expiresAt: isoUtc(token.expires_at),
    lastRegeneratedAt: isoUtc(token.last_regenerated_at),
    status: token.status,
    cleanupOnDelete: token.cleanup_on_delete === 1,
    cleanedUpAt: isoUtc(token.cleaned_up_at),
  };
}
