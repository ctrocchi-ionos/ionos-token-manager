import { config, decodeJwtHeader, decodeJwtPayload } from '../config.js';
import { encrypt, decrypt } from './crypto.js';
import * as db from '../db/queries.js';

const CHECK_INTERVAL_MS = 3600000; // 1 hour

let intervalId: ReturnType<typeof setInterval> | null = null;

export function bootstrapAdminToken(): boolean {
  const existing = db.getAdminTokenState();
  if (existing) {
    // Load from DB (may be newer than env var)
    try {
      const storedToken = decrypt(existing.current_token_enc);
      config.setAdminToken(storedToken);
      console.log(`[AdminRenewal] Loaded admin token from DB (expires: ${existing.expires_at})`);
      return true;
    } catch {
      console.warn('[AdminRenewal] Could not decrypt stored token — please reconfigure via the setup page');
      return false;
    }
  }

  // No DB entry — check if an env var token was loaded at startup
  if (!config.isConfigured) {
    console.log('[AdminRenewal] No admin token found — visit the app to complete setup');
    return false;
  }

  // First run with env var: store it in DB
  const token = config.getAdminToken();
  const payload = decodeJwtPayload(token);
  const header = decodeJwtHeader(token);

  db.upsertAdminTokenState({
    currentTokenEnc: encrypt(token),
    tokenId: header.kid,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  });

  console.log(`[AdminRenewal] Bootstrapped admin token from environment (expires: ${new Date(payload.exp * 1000).toISOString()})`);
  return true;
}

export async function configureAdminToken(rawToken: string): Promise<void> {
  // setAdminToken validates the JWT and updates in-memory config fields
  config.setAdminToken(rawToken);

  const payload = decodeJwtPayload(rawToken);
  const header = decodeJwtHeader(rawToken);

  db.upsertAdminTokenState({
    currentTokenEnc: encrypt(rawToken),
    tokenId: header.kid,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  });

  // Record when the token was last configured and clear any stale error
  db.updateAdminTokenRenewal({
    lastRenewalAt: new Date().toISOString(),
    lastRenewalError: null,
  });

  db.insertAuditLog({
    action: 'admin.configure',
    entityType: 'admin',
    details: {
      tokenId: header.kid,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    },
  });

  console.log(`[AdminRenewal] Admin token configured via setup (expires: ${new Date(payload.exp * 1000).toISOString()})`);
}

// Checks expiry and logs a warning if the token is within the threshold.
// NOTE: IONOS does not allow token generation via API (requires web login with 2FA).
// This only logs — it does not attempt any API call.
function checkExpiry(): void {
  const state = db.getAdminTokenState();
  if (!state) return;

  const expiresAt = new Date(state.expires_at).getTime();
  const now = Date.now();
  const thresholdMs = state.renewal_threshold_seconds * 1000;
  const timeLeft = expiresAt - now;
  const daysLeft = Math.floor(timeLeft / 86400000);

  if (timeLeft <= 0) {
    console.warn('[AdminRenewal] Admin token has EXPIRED. Log in to the IONOS console, generate a new token, and replace it via Settings.');
  } else if (timeLeft <= thresholdMs) {
    console.warn(`[AdminRenewal] Admin token expires in ${daysLeft} day(s). Log in to the IONOS console, generate a new token, and replace it via Settings.`);
  }
}

export function startAutoRenewal(): void {
  // Check immediately on startup
  checkExpiry();
  // Then check periodically
  intervalId = setInterval(checkExpiry, CHECK_INTERVAL_MS);
  console.log('[AdminRenewal] Token expiry monitor started (checking every hour)');
}

export function stopAutoRenewal(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[AdminRenewal] Token expiry monitor stopped');
  }
}

export function getAdminTokenStatus(): {
  tokenId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  lastUpdatedAt: string | null;
} {
  const state = db.getAdminTokenState();
  if (!state) {
    return {
      tokenId: null, issuedAt: null, expiresAt: null, daysRemaining: 0,
      lastUpdatedAt: null,
    };
  }

  const timeLeft = new Date(state.expires_at).getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.floor(timeLeft / 86400000));

  return {
    tokenId: state.token_id,
    issuedAt: state.issued_at,
    expiresAt: state.expires_at,
    daysRemaining,
    lastUpdatedAt: state.last_renewal_at,
  };
}
