import { config, decodeJwtHeader, decodeJwtPayload } from '../config.js';
import { encrypt, decrypt } from './crypto.js';
import * as ionosAuth from './ionos-auth.js';
import * as db from '../db/queries.js';

const CHECK_INTERVAL_MS = 3600000; // 1 hour

let intervalId: ReturnType<typeof setInterval> | null = null;

export function bootstrapAdminToken(): void {
  const existing = db.getAdminTokenState();
  if (existing) {
    // Load from DB (may be newer than .env)
    try {
      const storedToken = decrypt(existing.current_token_enc);
      config.setAdminToken(storedToken);
      console.log(`[AdminRenewal] Loaded admin token from DB (expires: ${existing.expires_at})`);
    } catch {
      console.warn('[AdminRenewal] Could not decrypt stored token, using .env token');
    }
    return;
  }

  // First run: store the .env token in DB
  const token = config.getAdminToken();
  const payload = decodeJwtPayload(token);
  const header = decodeJwtHeader(token);

  db.upsertAdminTokenState({
    currentTokenEnc: encrypt(token),
    tokenId: header.kid,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  });

  console.log(`[AdminRenewal] Bootstrapped admin token from .env (expires: ${new Date(payload.exp * 1000).toISOString()})`);
}

export async function checkAndRenew(): Promise<{ renewed: boolean; message: string }> {
  const state = db.getAdminTokenState();
  if (!state) return { renewed: false, message: 'No admin token state found' };
  if (!state.auto_renew_enabled) return { renewed: false, message: 'Auto-renewal is disabled' };

  const expiresAt = new Date(state.expires_at).getTime();
  const now = Date.now();
  const thresholdMs = state.renewal_threshold_seconds * 1000;
  const timeLeft = expiresAt - now;

  if (timeLeft > thresholdMs) {
    const daysLeft = Math.floor(timeLeft / 86400000);
    return { renewed: false, message: `Token still valid (${daysLeft} days remaining)` };
  }

  return await renewToken();
}

export async function renewToken(): Promise<{ renewed: boolean; message: string }> {
  const state = db.getAdminTokenState();
  if (!state) return { renewed: false, message: 'No admin token state found' };

  try {
    const currentToken = decrypt(state.current_token_enc);

    // Generate new token
    const newJwt = await ionosAuth.generateToken(state.renewal_ttl_seconds, currentToken);
    const payload = decodeJwtPayload(newJwt);
    const header = decodeJwtHeader(newJwt);
    const newExpiresAt = new Date(payload.exp * 1000).toISOString();

    // Update DB
    db.updateAdminTokenRenewal({
      currentTokenEnc: encrypt(newJwt),
      tokenId: header.kid,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: newExpiresAt,
      lastRenewalAt: new Date().toISOString(),
      lastRenewalError: null,
    });

    // Update in-memory
    config.setAdminToken(newJwt);

    // Audit
    db.insertAuditLog({
      action: 'admin.renew',
      entityType: 'admin',
      details: { newTokenId: header.kid, expiresAt: newExpiresAt },
    });

    // Delete old token (non-critical)
    if (state.token_id) {
      try {
        await ionosAuth.deleteToken(state.token_id, newJwt);
      } catch {
        // Old token will expire naturally
      }
    }

    console.log(`[AdminRenewal] Token renewed successfully (new expiry: ${newExpiresAt})`);
    return { renewed: true, message: `Token renewed, new expiry: ${newExpiresAt}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[AdminRenewal] Renewal failed: ${message}`);

    db.updateAdminTokenRenewal({ lastRenewalError: message });
    db.insertAuditLog({
      action: 'admin.renew',
      entityType: 'admin',
      success: false,
      errorMessage: message,
    });

    return { renewed: false, message: `Renewal failed: ${message}` };
  }
}

export function startAutoRenewal(): void {
  // Check immediately
  checkAndRenew().catch((err) => console.error('[AdminRenewal] Initial check failed:', err));
  // Then periodically
  intervalId = setInterval(() => {
    checkAndRenew().catch((err) => console.error('[AdminRenewal] Check failed:', err));
  }, CHECK_INTERVAL_MS);
  console.log('[AdminRenewal] Auto-renewal started (checking every hour)');
}

export function stopAutoRenewal(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[AdminRenewal] Auto-renewal stopped');
  }
}

export function getAdminTokenStatus(): {
  tokenId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  autoRenewEnabled: boolean;
  renewalTtlSeconds: number;
  renewalThresholdSeconds: number;
  lastRenewalAt: string | null;
  lastRenewalError: string | null;
} {
  const state = db.getAdminTokenState();
  if (!state) {
    return {
      tokenId: null, issuedAt: null, expiresAt: null, daysRemaining: 0,
      autoRenewEnabled: false, renewalTtlSeconds: 2592000,
      renewalThresholdSeconds: 604800, lastRenewalAt: null, lastRenewalError: null,
    };
  }

  const timeLeft = new Date(state.expires_at).getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.floor(timeLeft / 86400000));

  return {
    tokenId: state.token_id,
    issuedAt: state.issued_at,
    expiresAt: state.expires_at,
    daysRemaining,
    autoRenewEnabled: state.auto_renew_enabled === 1,
    renewalTtlSeconds: state.renewal_ttl_seconds,
    renewalThresholdSeconds: state.renewal_threshold_seconds,
    lastRenewalAt: state.last_renewal_at,
    lastRenewalError: state.last_renewal_error,
  };
}
