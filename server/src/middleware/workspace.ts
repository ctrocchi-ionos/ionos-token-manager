import type { Request, Response, NextFunction } from 'express';
import { openWorkspace } from '../workspace/registry.js';
import * as q from '../workspace/queries.js';

/** Open the signed-in user's private workspace. Must run after ssoAuth. */
export function attachWorkspace(req: Request, _res: Response, next: NextFunction): void {
  req.ws = openWorkspace(req.user.email);
  next();
}

/** Resolve the DCD account selected in the X-DCD-Account header, inside this user's workspace only. */
export function requireAccount(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-dcd-account'] as string | undefined)?.trim();
  if (!id) {
    res.status(400).json({ success: false, error: { code: 'ACCOUNT_REQUIRED', message: 'Select a DCD account first' } });
    return;
  }
  const account = q.getAccount(req.ws.db, id);
  if (!account) {
    res.status(404).json({ success: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'DCD account not found' } });
    return;
  }
  req.account = { id: account.id, label: account.label, contractNumber: account.contract_number };
  next();
}
