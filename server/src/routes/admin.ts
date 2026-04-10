import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import * as adminRenewal from '../services/admin-renewal.js';
import * as db from '../db/queries.js';
import { ValidationError } from '../middleware/error-handler.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router = Router();

// Health check
router.get('/health', (_req: Request, res: Response) => {
  const tokenStatus = adminRenewal.getAdminTokenStatus();
  res.json({
    success: true,
    data: {
      status: 'ok',
      tokenStatus,
      dbConnected: true,
    },
  });
});

// Get admin token status
router.get('/token-status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: adminRenewal.getAdminTokenStatus(),
  });
});

// Manual renewal trigger
router.post('/token-renew', asyncHandler(async (_req: Request, res: Response) => {
  const result = await adminRenewal.renewToken();
  res.json({ success: true, data: result });
}));

// Update renewal config
const configSchema = z.object({
  renewalTtlSeconds: z.number().int().min(3600).max(31536000).optional(),
  renewalThresholdSeconds: z.number().int().min(3600).max(31536000).optional(),
  autoRenewEnabled: z.boolean().optional(),
});

router.put('/token-config', (req: Request, res: Response) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid config', parsed.error.flatten());

  db.updateAdminTokenConfig(parsed.data);
  res.json({
    success: true,
    data: adminRenewal.getAdminTokenStatus(),
  });
});

export default router;
