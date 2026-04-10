import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import * as db from '../db/queries.js';
import * as tokenCreator from '../services/token-creator.js';
import { ValidationError, NotFoundError } from '../middleware/error-handler.js';
import { asyncHandler } from '../middleware/async-handler.js';

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

// Create a managed token
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const parsed = createTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Invalid request', parsed.error.flatten());
  }

  const result = await tokenCreator.createManagedToken(parsed.data);
  res.status(201).json({ success: true, data: result });
}));

// List managed tokens
router.get('/', (req: Request, res: Response) => {
  const { status, search, page, limit } = req.query;
  const result = db.listManagedTokens({
    status: status as string | undefined,
    search: search as string | undefined,
    page: page ? parseInt(page as string, 10) : undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
  });

  // Auto-mark expired tokens
  for (const token of result.items) {
    if (token.status === 'active' && new Date(token.expires_at) <= new Date()) {
      db.updateManagedTokenStatus(token.id, 'expired');
      token.status = 'expired';
    }
  }

  res.json({
    success: true,
    data: result.items.map(tokenCreator.tokenToResponse),
    pagination: {
      total: result.total,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 50,
    },
  });
});

// Get token stats
router.get('/stats', (_req: Request, res: Response) => {
  const stats = db.getTokenStats();
  res.json({ success: true, data: stats });
});

// Export tokens
router.get('/export', (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'json';
  const result = db.listManagedTokens({ limit: 10000 });
  const tokens = result.items.map(tokenCreator.tokenToResponse);

  if (format === 'csv') {
    const headers = 'ID,Name,Description,Status,Permissions,Created,Expires,Sub-User Email\n';
    const rows = tokens.map((t) => {
      const perms = Object.entries(t.permissions)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(';');
      return `"${t.id}","${t.name}","${t.description ?? ''}","${t.status}","${perms}","${t.createdAt}","${t.expiresAt}","${t.subUserEmail}"`;
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

// Get single token
router.get('/:id', (req: Request, res: Response) => {
  const token = db.getManagedTokenById(req.params.id);
  if (!token) throw new NotFoundError('Token', req.params.id);

  // Auto-mark expired
  if (token.status === 'active' && new Date(token.expires_at) <= new Date()) {
    db.updateManagedTokenStatus(token.id, 'expired');
    token.status = 'expired';
  }

  res.json({ success: true, data: tokenCreator.tokenToResponse(token) });
});

// Regenerate token
router.post('/:id/regenerate', asyncHandler(async (req: Request, res: Response) => {
  const token = db.getManagedTokenById(req.params.id);
  if (!token) throw new NotFoundError('Token', req.params.id);

  const result = await tokenCreator.regenerateToken(req.params.id);
  res.json({ success: true, data: result });
}));

// Revoke/delete token
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const token = db.getManagedTokenById(req.params.id);
  if (!token) throw new NotFoundError('Token', req.params.id);

  await tokenCreator.revokeManagedToken(req.params.id);
  res.json({ success: true, data: { message: 'Token revoked' } });
}));

// Remove from local DB (for revoked/expired tokens already cleaned up)
router.delete('/:id/dismiss', asyncHandler((req: Request, res: Response) => {
  const token = db.getManagedTokenById(req.params.id);
  if (!token) throw new NotFoundError('Token', req.params.id);
  if (token.status !== 'revoked' && token.status !== 'expired') {
    throw new ValidationError('Only revoked or expired tokens can be dismissed. Revoke it first.');
  }
  db.deleteManagedToken(req.params.id);
  db.insertAuditLog({ action: 'token.dismiss', entityType: 'token', entityId: req.params.id });
  res.json({ success: true, data: { message: 'Token removed from list' } });
}));

// Bulk delete
router.post('/bulk-delete', asyncHandler(async (req: Request, res: Response) => {
  const { criteria, ids } = req.body as { criteria?: string; ids?: string[] };

  let tokensToDelete: string[] = [];

  if (criteria === 'expired') {
    const expired = db.getExpiredTokens();
    const result = db.listManagedTokens({ status: 'expired', limit: 10000 });
    tokensToDelete = [...expired.map((t) => t.id), ...result.items.map((t) => t.id)];
    tokensToDelete = [...new Set(tokensToDelete)];
  } else if (ids && Array.isArray(ids)) {
    tokensToDelete = ids;
  } else {
    throw new ValidationError('Provide criteria ("expired") or ids array');
  }

  let deleted = 0;
  const errors: string[] = [];

  for (const id of tokensToDelete) {
    try {
      await tokenCreator.revokeManagedToken(id);
      deleted++;
    } catch (err) {
      errors.push(`${id}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  res.json({ success: true, data: { deleted, errors } });
}));

export default router;
