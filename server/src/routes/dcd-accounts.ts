import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import * as q from '../workspace/queries.js';
import * as accounts from '../services/dcd-accounts.js';
import { ValidationError } from '../middleware/error-handler.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router = Router();

const tokenBody = z.object({ token: z.string().min(1).max(10000) });
const addBody = tokenBody.extend({ label: z.string().max(60).optional() });
const labelBody = z.object({ label: z.string().min(1).max(60) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new ValidationError('Invalid request', r.error.flatten());
  return r.data;
}

router.get('/', (req: Request, res: Response) => {
  res.json({ success: true, data: q.listAccounts(req.ws.db).map((a) => accounts.toAccountResponse(req.ws, a)) });
});

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { label, token } = parse(addBody, req.body);
  const a = await accounts.addAccount(req.ws, label, token);
  res.status(201).json({ success: true, data: accounts.toAccountResponse(req.ws, a) });
}));

router.put('/:id/token', asyncHandler(async (req: Request, res: Response) => {
  const { token } = parse(tokenBody, req.body);
  const a = await accounts.replaceAccountToken(req.ws, req.params.id as string, token);
  res.json({ success: true, data: accounts.toAccountResponse(req.ws, a) });
}));

router.patch('/:id', (req: Request, res: Response) => {
  const { label } = parse(labelBody, req.body);
  const a = accounts.renameAccountLabel(req.ws, req.params.id as string, label);
  res.json({ success: true, data: accounts.toAccountResponse(req.ws, a) });
});

router.delete('/:id', (req: Request, res: Response) => {
  accounts.removeAccount(req.ws, req.params.id as string);
  res.json({ success: true, data: { message: 'Account removed' } });
});

export default router;
