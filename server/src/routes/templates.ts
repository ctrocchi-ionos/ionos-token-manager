import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import * as db from '../db/queries.js';
import { ValidationError, NotFoundError } from '../middleware/error-handler.js';
import type { PermissionTemplateResponse } from '../types/app.js';

const router = Router();

function templateToResponse(t: ReturnType<typeof db.getPermissionTemplateById> & {}): PermissionTemplateResponse {
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

// List templates
router.get('/', (_req: Request, res: Response) => {
  const templates = db.listPermissionTemplates();
  res.json({ success: true, data: templates.map(templateToResponse) });
});

// Create template
router.post('/', (req: Request, res: Response) => {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten());

  if (db.templateExistsByName(parsed.data.name)) {
    throw new ValidationError(`Template "${parsed.data.name}" already exists`);
  }

  const template = db.insertPermissionTemplate(parsed.data);
  res.status(201).json({ success: true, data: templateToResponse(template) });
});

// Update template
router.put('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const existing = db.getPermissionTemplateById(id);
  if (!existing) throw new NotFoundError('Template', id);
  if (existing.is_builtin) throw new ValidationError('Cannot modify built-in templates');

  const parsed = createTemplateSchema.partial().safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten());

  db.updatePermissionTemplate(id, parsed.data);
  const updated = db.getPermissionTemplateById(id)!;
  res.json({ success: true, data: templateToResponse(updated) });
});

// Delete template
router.delete('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const existing = db.getPermissionTemplateById(id);
  if (!existing) throw new NotFoundError('Template', id);
  if (existing.is_builtin) throw new ValidationError('Cannot delete built-in templates');

  db.deletePermissionTemplate(id);
  res.json({ success: true, data: { message: 'Template deleted' } });
});

export default router;
