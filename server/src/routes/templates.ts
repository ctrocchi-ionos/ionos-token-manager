import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import * as q from '../workspace/queries.js';
import { ValidationError, NotFoundError } from '../middleware/error-handler.js';
import type { TemplateRow } from '../workspace/types.js';
import type { PermissionTemplateResponse } from '../types/app.js';

const router = Router();

function templateToResponse(t: TemplateRow): PermissionTemplateResponse {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    permissions: JSON.parse(t.permissions),
    sharedResourceTypes: JSON.parse(t.shared_resource_types),
    isBuiltin: t.is_builtin === 1,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  permissions: z.record(z.boolean()),
  sharedResourceTypes: z.array(z.string()).optional(),
});

function mustGetCustom(req: Request, id: string): TemplateRow {
  const t = q.getPermissionTemplateById(req.ws.db, id);
  if (!t) throw new NotFoundError('Template', id);
  if (t.is_builtin) throw new ValidationError('Built-in templates cannot be changed');
  return t;
}

router.get('/', (req: Request, res: Response) => {
  res.json({ success: true, data: q.listPermissionTemplates(req.ws.db).map(templateToResponse) });
});

router.post('/', (req: Request, res: Response) => {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten());
  if (q.templateExistsByName(req.ws.db, parsed.data.name)) {
    throw new ValidationError(`Template "${parsed.data.name}" already exists`);
  }
  const t = q.insertPermissionTemplate(req.ws.db, parsed.data);
  q.insertAuditLog(req.ws.db, { action: 'template.create', entityType: 'template', entityId: t.id, details: { name: t.name } });
  res.status(201).json({ success: true, data: templateToResponse(t) });
});

router.put('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  mustGetCustom(req, id);
  const parsed = createTemplateSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten());
  q.updatePermissionTemplate(req.ws.db, id, parsed.data);
  q.insertAuditLog(req.ws.db, { action: 'template.update', entityType: 'template', entityId: id });
  res.json({ success: true, data: templateToResponse(q.getPermissionTemplateById(req.ws.db, id)!) });
});

router.delete('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const t = mustGetCustom(req, id);
  q.deletePermissionTemplate(req.ws.db, id);
  q.insertAuditLog(req.ws.db, { action: 'template.delete', entityType: 'template', entityId: id, details: { name: t.name } });
  res.json({ success: true, data: { message: 'Template deleted' } });
});

export default router;
