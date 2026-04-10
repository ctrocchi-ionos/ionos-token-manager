import { Router, type Request, type Response } from 'express';
import * as ionosCloud from '../services/ionos-cloud.js';

const router = Router();

// List datacenters
router.get('/datacenters', async (_req: Request, res: Response) => {
  const datacenters = await ionosCloud.listDatacenters();
  const simplified = datacenters.map((dc) => ({
    id: dc.id,
    name: dc.properties.name,
    description: dc.properties.description ?? null,
    location: dc.properties.location,
  }));
  res.json({ success: true, data: simplified });
});

// List all resources
router.get('/all', async (_req: Request, res: Response) => {
  const resources = await ionosCloud.listAllResources();
  const simplified = resources.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.properties?.name ?? r.id,
  }));
  res.json({ success: true, data: simplified });
});

// List resources by type
router.get('/:type', async (req: Request, res: Response) => {
  const resources = await ionosCloud.listResourcesByType(req.params.type);
  const simplified = resources.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.properties?.name ?? r.id,
  }));
  res.json({ success: true, data: simplified });
});

export default router;
