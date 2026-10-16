import { Router, type Request, type Response } from 'express';
import * as ionosCloud from '../services/ionos-cloud.js';
import { getAccountAdminToken } from '../services/dcd-accounts.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAccount } from '../middleware/workspace.js';

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

export default router;
