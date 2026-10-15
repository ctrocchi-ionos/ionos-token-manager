import { Router, type Request, type Response } from 'express';
import * as ionosCloud from '../services/ionos-cloud.js';
import { getAccountAdminToken } from '../services/dcd-accounts.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAccount } from '../middleware/workspace.js';
import { ValidationError } from '../middleware/error-handler.js';

const router = Router();
router.use(requireAccount);

router.get('/datacenters', asyncHandler(async (req: Request, res: Response) => {
  const datacenters = await ionosCloud.listDatacenters(getAccountAdminToken(req.ws, req.account.id));
  res.json({
    success: true,
    data: datacenters.map((dc) => ({
      id: dc.id,
      name: dc.properties.name,
      description: dc.properties.description ?? null,
      location: dc.properties.location,
    })),
  });
}));

router.get('/all', asyncHandler(async (req: Request, res: Response) => {
  const resources = await ionosCloud.listAllResources(getAccountAdminToken(req.ws, req.account.id));
  res.json({ success: true, data: resources.map((r) => ({ id: r.id, type: r.type, name: r.properties?.name ?? r.id })) });
}));

router.get('/:type', asyncHandler(async (req: Request, res: Response) => {
  const type = req.params.type as string;
  if (!/^[a-z_]{1,40}$/i.test(type)) throw new ValidationError('Invalid resource type');
  const resources = await ionosCloud.listResourcesByType(getAccountAdminToken(req.ws, req.account.id), type);
  res.json({ success: true, data: resources.map((r) => ({ id: r.id, type: r.type, name: r.properties?.name ?? r.id })) });
}));

export default router;
