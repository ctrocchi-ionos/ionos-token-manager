import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { decodeJwtHeader, decodeJwtPayload } from '../config.js';
import { encrypt } from './crypto.js';
import * as ionosAuth from './ionos-auth.js';
import * as ionosCloud from './ionos-cloud.js';
import * as db from '../db/queries.js';
import { TokenCreationError, AppError } from '../middleware/error-handler.js';
import axios from 'axios';
import type { CreateTokenRequest, CreateTokenResult, ManagedTokenResponse, SharedResource } from '../types/app.js';

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

export async function createManagedToken(req: CreateTokenRequest, ownerEmail: string, actorEmail: string, adminToken: string): Promise<CreateTokenResult> {
  const rollback = new Rollback();
  const internalId = uuidv4();
  const shortId = internalId.slice(0, 8);

  // Step 1: Generate credentials
  const contractNumber = decodeJwtPayload(adminToken).identity.contractNumber;
  const email = `tkn-${shortId}@c${contractNumber}.tokenmanager.internal`;
  const password = generatePassword();

  let ionosUserId = '';
  let ionosGroupId = '';
  let ionosTokenId = '';
  let tokenJwt = '';

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
          adminToken,
          ionosGroupId,
          resource.resourceId,
          resource.editPrivilege,
          resource.sharePrivilege,
        );
      }
    }

    // Step 6: Generate token as the sub-user
    console.log(`[TokenCreator] Step 6: Generating token (TTL: ${req.ttlSeconds}s)`);
    // Wait a moment for user propagation
    await new Promise((r) => setTimeout(r, 3000));
    tokenJwt = await ionosAuth.generateTokenAsUser(email, password, req.ttlSeconds);

    // Extract token ID from JWT header
    const header = decodeJwtHeader(tokenJwt);
    ionosTokenId = header.kid;
    const payload = decodeJwtPayload(tokenJwt);
    const expiresAt = new Date(payload.exp * 1000).toISOString();

    // Step 7: Persist to database
    console.log(`[TokenCreator] Step 7: Persisting to database`);
    const encryptedPassword = encrypt(password);
    db.insertManagedToken({
      id: internalId,
      name: req.name,
      description: req.description ?? null,
      ionos_token_id: ionosTokenId,
      ionos_user_id: ionosUserId,
      ionos_group_id: ionosGroupId,
      sub_user_email: email,
      sub_user_password_enc: encryptedPassword,
      permissions: JSON.stringify(req.permissions),
      shared_resources: JSON.stringify(req.sharedResources ?? []),
      template_id: req.templateId ?? null,
      ttl_seconds: req.ttlSeconds,
      expires_at: expiresAt,
      status: 'active',
      cleanup_on_delete: req.cleanupOnDelete !== false ? 1 : 0,
      owner_email: ownerEmail,
    });

    // Audit log
    db.insertAuditLog({
      action: 'token.create',
      entityType: 'token',
      entityId: internalId,
      actorEmail,
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
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TokenCreator] Failed: ${message}`);

    // Execute rollback
    const rollbackResults = await rollback.execute();

    // Audit the failure
    db.insertAuditLog({
      action: 'token.create',
      entityType: 'token',
      entityId: internalId,
      actorEmail,
      details: { name: req.name, rollbackResults },
      success: false,
      errorMessage: message,
    });

    throw new TokenCreationError(message, 'creation', rollbackResults);
  }
}

export async function regenerateToken(id: string, actorEmail: string, adminToken: string): Promise<{ tokenValue: string; expiresAt: string }> {
  const token = db.getManagedTokenById(id);
  if (!token) throw new Error(`Token not found: ${id}`);
  if (token.status === 'revoked') {
    throw new AppError('This token was revoked and cannot be regenerated. Create a new one.', 'VALIDATION_ERROR', 400);
  }
  if (token.cleaned_up_at) {
    throw new AppError('This token expired and its IONOS user was cleaned up automatically. Create a new token.', 'VALIDATION_ERROR', 400);
  }

  // Decrypt the sub-user password
  const { decrypt } = await import('./crypto.js');
  const password = decrypt(token.sub_user_password_enc);

  // Generate a new token as the sub-user
  const tokenJwt = await ionosAuth.generateTokenAsUser(
    token.sub_user_email,
    password,
    token.ttl_seconds,
  );

  const header = decodeJwtHeader(tokenJwt);
  const payload = decodeJwtPayload(tokenJwt);
  const expiresAt = new Date(payload.exp * 1000).toISOString();
  const oldTokenId = token.ionos_token_id;

  // Update in database
  db.updateManagedTokenIonosId(id, header.kid, expiresAt);

  // Best-effort: delete the previous token so it doesn't linger as an orphan
  let oldTokenDeleted = false;
  let oldTokenDeleteError: string | undefined;
  if (oldTokenId) {
    try {
      await ionosAuth.deleteTokenAsUser(token.sub_user_email, password, oldTokenId);
      oldTokenDeleted = true;
    } catch (err) {
      oldTokenDeleteError = err instanceof Error ? err.message : 'unknown error';
      console.warn(`[TokenCreator] Failed to delete old token ${oldTokenId} during regenerate: ${oldTokenDeleteError}`);
    }
  }

  db.insertAuditLog({
    action: 'token.regenerate',
    entityType: 'token',
    entityId: id,
    actorEmail,
    details: { newTokenId: header.kid, expiresAt, oldTokenId, oldTokenDeleted, oldTokenDeleteError },
  });

  return { tokenValue: tokenJwt, expiresAt };
}

function isNotFound(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown';
}

/**
 * Delete the sub-user and group on IONOS (a 404 means "already gone" and counts as success).
 * Returns a list of error messages; empty means everything is gone.
 */
export async function cleanupIonosAccess(token: ManagedToken, adminToken: string): Promise<string[]> {
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

export async function revokeManagedToken(id: string, actorEmail: string, adminToken: string): Promise<void> {
  const token = db.getManagedTokenById(id);
  if (!token) throw new Error(`Token not found: ${id}`);

  const errors: string[] = [];
  const alreadyCleanedUp = !!token.cleaned_up_at;

  if (token.cleanup_on_delete) {
    // Deleting the sub-user also removes its S3 keys and invalidates its token on IONOS.
    if (!alreadyCleanedUp) errors.push(...await cleanupIonosAccess(token, adminToken));
  } else if (token.ionos_token_id && token.status !== 'expired') {
    // Cleanup is off: keep the user, but the token itself must stop working.
    try {
      const { decrypt } = await import('./crypto.js');
      await ionosAuth.deleteTokenAsUser(token.sub_user_email, decrypt(token.sub_user_password_enc), token.ionos_token_id);
    } catch (err) {
      if (!isNotFound(err)) errors.push(`Could not delete the IONOS token: ${errMsg(err)}`);
    }
  }

  if (errors.length > 0) {
    // Do NOT mark it revoked: access may still be live. Keep the row so the user can retry.
    db.insertAuditLog({
      action: 'token.revoke',
      entityType: 'token',
      entityId: id,
      actorEmail,
      details: { cleanedUp: false, errors },
      success: false,
      errorMessage: errors.join('; '),
    });
    throw new AppError(`Revoke incomplete, the token may still work. ${errors.join('; ')}`, 'REVOKE_INCOMPLETE', 502, { errors });
  }

  db.updateManagedTokenStatus(id, 'revoked');

  db.insertAuditLog({
    action: 'token.revoke',
    entityType: 'token',
    entityId: id,
    actorEmail,
    details: { cleanedUp: token.cleanup_on_delete === 1 },
  });
}

export function tokenToResponse(token: ManagedToken): ManagedTokenResponse {
  return {
    id: token.id,
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
    createdAt: token.created_at,
    expiresAt: token.expires_at,
    lastRegeneratedAt: token.last_regenerated_at,
    status: token.status,
    cleanupOnDelete: token.cleanup_on_delete === 1,
    cleanedUpAt: token.cleaned_up_at,
  };
}

// Import the type we need
import type { ManagedToken } from '../types/app.js';
