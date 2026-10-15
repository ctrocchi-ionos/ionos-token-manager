import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import * as q from '../workspace/queries.js';
import * as tokenCreator from '../services/token-creator.js';
import { getAccountAdminToken } from '../services/dcd-accounts.js';
import { ValidationError, NotFoundError } from '../middleware/error-handler.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAccount } from '../middleware/workspace.js';
import { csvRow } from '../lib/csv.js';
import { parsePaging } from '../lib/paging.js';

const router = Router();

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.record(z.boolean()).refine((p) => Object.values(p).some(Boolean), {
    message: 'At least one permission must be enabled',
  }),
  sharedResources: z.array(z.object({
    resourceId: z.string(),
    type: z.string(),
    name: z.string(),
    editPrivilege: z.boolean(),
    sharePrivilege: z.boolean(),
  })).optional(),
  ttlSeconds: z.number().int().min(60).max(31536000),
  templateId: z.string().optional(),
  cleanupOnDelete: z.boolean().optional(),
});

// Create a managed token in the selected DCD account
router.post('/', requireAccount, asyncHandler(async (req: Request, res: Response) => {
  const parsed = createTokenSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten());
  const adminToken = getAccountAdminToken(req.ws, req.account.id);
  const result = await tokenCreator.createManagedToken(req.ws, req.account.id, adminToken, parsed.data);
  res.status(201).json({ success: true, data: result });
}));

// List tokens of the selected account
router.get('/', requireAccount, (req: Request, res: Response) => {
  const { page, limit } = parsePaging(req.query);
  q.markExpiredTokens(req.ws.db, req.account.id);
  const result = q.listManagedTokens(req.ws.db, {
    accountId: req.account.id,
    status: req.query.status as string | undefined,
    search: req.query.search as string | undefined,
    page,
    limit,
  });
  res.json({
    success: true,
    data: result.items.map(tokenCreator.tokenToResponse),
    pagination: { total: result.total, page, limit },
  });
});

router.get('/stats', requireAccount, (req: Request, res: Response) => {
  q.markExpiredTokens(req.ws.db, req.account.id);
  res.json({ success: true, data: q.getTokenStats(req.ws.db, req.account.id) });
});

router.get('/export', requireAccount, (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'json';
  const tokens = q.listManagedTokens(req.ws.db, { accountId: req.account.id, limit: 100000 }).items.map(tokenCreator.tokenToResponse);

  if (format === 'csv') {
    const headers = csvRow(['ID', 'Account', 'Name', 'Description', 'Status', 'Permissions', 'Created', 'Expires', 'Sub-User Email']) + '\n';
    const rows = tokens.map((t) => {
      const perms = Object.entries(t.permissions).filter(([, v]) => v).map(([k]) => k).join(';');
      return csvRow([t.id, req.account.label, t.name, t.description, t.status, perms, t.createdAt, t.expiresAt, t.subUserEmail]);
    }).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=tokens.csv');
    res.send(headers + rows);
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=tokens.json');
    res.json({ success: true, data: tokens });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  q.markExpiredTokens(req.ws.db);
  const token = q.getManagedTokenById(req.ws.db, id);
  if (!token) throw new NotFoundError('Token', id);
  res.json({ success: true, data: tokenCreator.tokenToResponse(token) });
});

router.post('/:id/regenerate', asyncHandler(async (req: Request, res: Response) => {
  const result = await tokenCreator.regenerateToken(req.ws, req.params.id as string);
  res.json({ success: true, data: result });
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  await tokenCreator.revokeManagedToken(req.ws, req.params.id as string);
  res.json({ success: true, data: { message: 'Token revoked' } });
}));

// Remove from the list (only revoked or expired tokens)
router.delete('/:id/dismiss', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const token = q.getManagedTokenById(req.ws.db, id);
  if (!token) throw new NotFoundError('Token', id);
  if (token.status !== 'revoked' && token.status !== 'expired') {
    throw new ValidationError('Only revoked or expired tokens can be dismissed. Revoke it first.');
  }
  // An expired token whose IONOS user still exists must be revoked (which removes that user) first.
  if (token.status === 'expired' && token.cleanup_on_delete === 1 && !token.cleaned_up_at) {
    throw new ValidationError('Revoke it first (this removes its IONOS user)');
  }
  q.deleteManagedToken(req.ws.db, id);
  q.insertAuditLog(req.ws.db, { action: 'token.dismiss', accountId: token.account_id, entityType: 'token', entityId: id });
  res.json({ success: true, data: { message: 'Token removed from list' } });
});

router.post('/bulk-delete', requireAccount, asyncHandler(async (req: Request, res: Response) => {
  const { criteria, ids } = (req.body ?? {}) as { criteria?: unknown; ids?: unknown };
  let targets: string[];
  if (criteria === 'expired') {
    q.markExpiredTokens(req.ws.db, req.account.id);
    targets = q.listManagedTokens(req.ws.db, { accountId: req.account.id, status: 'expired', limit: 100000 }).items.map((t) => t.id);
  } else if (Array.isArray(ids) && ids.every((i) => typeof i === 'string')) {
    // Only tokens of the selected account; ids from other accounts are ignored.
    targets = (ids as string[]).filter((id) => {
      const t = q.getManagedTokenById(req.ws.db, id);
      return !!t && t.account_id === req.account.id;
    });
  } else {
    throw new ValidationError('Provide criteria ("expired") or ids array');
  }

  let deleted = 0;
  const errors: string[] = [];
  for (const id of targets) {
    try {
      await tokenCreator.revokeManagedToken(req.ws, id);
      deleted++;
    } catch (err) {
      errors.push(`${id}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
  res.json({ success: true, data: { deleted, errors } });
}));

export default router;
