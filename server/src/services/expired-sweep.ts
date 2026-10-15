import * as db from '../db/queries.js';
import * as tokenCreator from './token-creator.js';
import { getAdminTokenFor } from './user-token.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Expired tokens are dead on IONOS, but their sub-user and group would stay forever.
 * Once a token has been expired for EXPIRED_CLEANUP_GRACE_DAYS (default 7), delete them.
 * Set the variable to -1 to turn this off. Only tokens created with "cleanup on delete" are touched.
 */
export async function runExpiredSweep(): Promise<{ cleaned: number; failed: number; skipped: number }> {
  const raw = process.env.EXPIRED_CLEANUP_GRACE_DAYS;
  const graceDays = raw === undefined || raw === '' ? 7 : Number(raw);
  const result = { cleaned: 0, failed: 0, skipped: 0 };
  if (!Number.isFinite(graceDays) || graceDays < 0) return result;

  for (const token of db.getTokensDueForCleanup(graceDays)) {
    let adminToken: string;
    try {
      adminToken = getAdminTokenFor(token.owner_email);
    } catch {
      result.skipped++; // owner has no usable admin token configured
      continue;
    }

    const errors = await tokenCreator.cleanupIonosAccess(token, adminToken);
    if (errors.length === 0) {
      db.markTokenCleanedUp(token.id);
      db.insertAuditLog({
        action: 'token.auto_cleanup',
        entityType: 'token',
        entityId: token.id,
        actorEmail: token.owner_email,
        details: { reason: 'expired', graceDays },
      });
      result.cleaned++;
    } else {
      db.insertAuditLog({
        action: 'token.auto_cleanup',
        entityType: 'token',
        entityId: token.id,
        actorEmail: token.owner_email,
        success: false,
        errorMessage: errors.join('; '),
      });
      result.failed++;
    }
  }
  return result;
}

export function startExpiredSweep(): void {
  const run = () => runExpiredSweep()
    .then((r) => { if (r.cleaned || r.failed) console.log(`[Sweep] cleaned=${r.cleaned} failed=${r.failed} skipped=${r.skipped}`); })
    .catch((err) => console.error('[Sweep] failed:', err instanceof Error ? err.message : err));
  setTimeout(run, 30_000).unref();
  setInterval(run, HOUR_MS).unref();
}
