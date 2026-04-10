import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { config, decodeJwtHeader, decodeJwtPayload } from '../config.js';
import { encrypt } from './crypto.js';
import * as ionosAuth from './ionos-auth.js';
import * as ionosCloud from './ionos-cloud.js';
import * as db from '../db/queries.js';
import { TokenCreationError } from '../middleware/error-handler.js';
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

export async function createManagedToken(req: CreateTokenRequest): Promise<CreateTokenResult> {
  const rollback = new Rollback();
  const internalId = uuidv4();
  const shortId = internalId.slice(0, 8);

  // Step 1: Generate credentials
  const email = `tkn-${shortId}@c${config.contractNumber}.tokenmanager.internal`;
  const password = generatePassword();

  let ionosUserId = '';
  let ionosGroupId = '';
  let ionosTokenId = '';
  let tokenJwt = '';

  try {
    // Step 2: Create sub-user
    console.log(`[TokenCreator] Step 2: Creating sub-user ${email}`);
    const user = await ionosCloud.createUser({
      firstname: 'TokenMgr',
      lastname: req.name.slice(0, 50),
      email,
      password,
    });
    ionosUserId = user.id;
    rollback.add('delete-user', () => ionosCloud.deleteUser(ionosUserId));

    // Step 3: Create group with permissions
    const groupName = `tkn-${req.name.slice(0, 30).replace(/[^a-zA-Z0-9-_ ]/g, '')}-${shortId}`;
    console.log(`[TokenCreator] Step 3: Creating group ${groupName}`);
    const group = await ionosCloud.createGroup(groupName, req.permissions);
    ionosGroupId = group.id;
    rollback.add('delete-group', () => ionosCloud.deleteGroup(ionosGroupId));

    // Step 4: Add user to group
    console.log(`[TokenCreator] Step 4: Adding user to group`);
    await ionosCloud.addUserToGroup(ionosGroupId, ionosUserId);

    // Step 5: Share resources (if any)
    if (req.sharedResources && req.sharedResources.length > 0) {
      console.log(`[TokenCreator] Step 5: Sharing ${req.sharedResources.length} resources`);
      for (const resource of req.sharedResources) {
        await ionosCloud.shareResourceWithGroup(
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
    });

    // Audit log
    db.insertAuditLog({
      action: 'token.create',
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
      status: 'active',
      cleanupOnDelete: req.cleanupOnDelete !== false,
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
      details: { name: req.name, rollbackResults },
      success: false,
      errorMessage: message,
    });

    throw new TokenCreationError(message, 'creation', rollbackResults);
  }
}

export async function regenerateToken(id: string): Promise<{ tokenValue: string; expiresAt: string }> {
  const token = db.getManagedTokenById(id);
  if (!token) throw new Error(`Token not found: ${id}`);

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

  // Update in database
  db.updateManagedTokenIonosId(id, header.kid, expiresAt);

  db.insertAuditLog({
    action: 'token.regenerate',
    entityType: 'token',
    entityId: id,
    details: { newTokenId: header.kid, expiresAt },
  });

  return { tokenValue: tokenJwt, expiresAt };
}

export async function revokeManagedToken(id: string): Promise<void> {
  const token = db.getManagedTokenById(id);
  if (!token) throw new Error(`Token not found: ${id}`);

  const errors: string[] = [];

  // Delete the IONOS token if we have its ID
  if (token.ionos_token_id) {
    try {
      // We need to delete the token using the admin token, not the sub-user's token
      // But the token ID belongs to the sub-user. We need to auth as the sub-user.
      const { decrypt } = await import('./crypto.js');
      const password = decrypt(token.sub_user_password_enc);
      // List sub-user's tokens and delete
      try {
        const subUserTokens = await ionosAuth.listTokens(undefined); // Can't list other user's tokens easily
        // Try to delete by ID using admin auth
        await ionosAuth.deleteToken(token.ionos_token_id);
      } catch {
        // Token may already be expired/deleted
        errors.push('Could not delete IONOS token (may already be expired)');
      }
    } catch {
      errors.push('Could not decrypt sub-user credentials');
    }
  }

  // Cleanup sub-user and group if requested
  if (token.cleanup_on_delete) {
    try {
      await ionosCloud.deleteUser(token.ionos_user_id);
    } catch (err) {
      errors.push(`Could not delete sub-user: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    try {
      await ionosCloud.deleteGroup(token.ionos_group_id);
    } catch (err) {
      errors.push(`Could not delete group: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  // Update local status
  db.updateManagedTokenStatus(id, 'revoked');

  db.insertAuditLog({
    action: 'token.revoke',
    entityType: 'token',
    entityId: id,
    details: { cleanedUp: token.cleanup_on_delete === 1, errors: errors.length > 0 ? errors : undefined },
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
    status: token.status,
    cleanupOnDelete: token.cleanup_on_delete === 1,
  };
}

// Import the type we need
import type { ManagedToken } from '../types/app.js';
