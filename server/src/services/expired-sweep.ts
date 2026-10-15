import * as q from '../workspace/queries.js';
import { acquireWorkspace, closeWorkspaceIfUnused, isWorkspaceOpen, listWorkspaceEmails, type Workspace } from '../workspace/registry.js';
import { withKeyLock } from '../lib/key-lock.js';
import * as tokenCreator from './token-creator.js';
import { getAccountAdminToken } from './dcd-accounts.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Expired tokens are dead on IONOS, but their sub-user and group would stay forever.
 * Once a token has been expired for EXPIRED_CLEANUP_GRACE_DAYS (default 7), delete them,
 * in every workspace, using the admin token of the DCD account the token belongs to.
 * Set the variable to -1 to turn this off. Only tokens created with "cleanup on delete" are touched.
 */
export async function runExpiredSweep(): Promise<{ cleaned: number; failed: number; skipped: number }> {
  const raw = process.env.EXPIRED_CLEANUP_GRACE_DAYS;
  const graceDays = raw === undefined || raw === '' ? 7 : Number(raw);
  const result = { cleaned: 0, failed: 0, skipped: 0 };
  if (!Number.isFinite(graceDays) || graceDays < 0) return result;

  for (const email of listWorkspaceEmails()) {
    const wasOpen = isWorkspaceOpen(email);
    let hold: ReturnType<typeof acquireWorkspace> | undefined;
    try {
      hold = acquireWorkspace(email);
      await sweepWorkspace(hold.ws, graceDays, result);
    } catch (err) {
      // One unreadable workspace must not stop the sweep for everyone else
      result.failed++;
      console.error(`[Sweep] A workspace could not be swept: ${err instanceof Error ? err.message : err}`);
    } finally {
      hold?.release();
      if (!wasOpen) closeWorkspaceIfUnused(email); // do not keep every user's file open after the sweep
    }
  }
  return result;
}

type SweepResult = { cleaned: number; failed: number; skipped: number };

async function sweepWorkspace(ws: Workspace, graceDays: number, result: SweepResult): Promise<void> {
  for (const { id } of q.getTokensDueForCleanup(ws.db, graceDays)) {
    // Same lock as regenerate and revoke; then read the token again, it may have been regenerated meanwhile
    await withKeyLock(tokenCreator.tokenLockKey(ws, id), () => sweepToken(ws, id, graceDays, result));
  }
}

async function sweepToken(ws: Workspace, id: string, graceDays: number, result: SweepResult): Promise<void> {
  const token = q.getTokenIfDueForCleanup(ws.db, id, graceDays);
  if (!token) return;
  let adminToken: string;
  try {
    adminToken = getAccountAdminToken(ws, token.account_id);
  } catch {
    result.skipped++; // that DCD account has no usable admin token right now
    return;
  }

  const errors = await tokenCreator.cleanupIonosAccess(token, adminToken);
  if (errors.length === 0) {
    q.markTokenCleanedUp(ws.db, token.id);
    q.insertAuditLog(ws.db, {
      action: 'token.auto_cleanup', accountId: token.account_id, entityType: 'token', entityId: token.id,
      details: { reason: 'expired', graceDays },
    });
    result.cleaned++;
  } else {
    q.insertAuditLog(ws.db, {
      action: 'token.auto_cleanup', accountId: token.account_id, entityType: 'token', entityId: token.id,
      success: false, errorMessage: errors.join('; '),
    });
    result.failed++;
  }
}

export function startExpiredSweep(): void {
  const run = () => runExpiredSweep()
    .then((r) => { if (r.cleaned || r.failed) console.log(`[Sweep] cleaned=${r.cleaned} failed=${r.failed} skipped=${r.skipped}`); })
    .catch((err) => console.error('[Sweep] failed:', err instanceof Error ? err.message : err));
  setTimeout(run, 30_000).unref();
  setInterval(run, HOUR_MS).unref();
}
