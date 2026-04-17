import { Router, type Request, type Response } from 'express';
import * as ionosCloud from '../services/ionos-cloud.js';
import * as ionosAuth from '../services/ionos-auth.js';
import * as adminRenewal from '../services/admin-renewal.js';
import * as db from '../db/queries.js';
import { decodeJwtPayload } from '../config.js';
import { getAdminTokenFor } from '../services/user-token.js';
import { AppError } from '../middleware/error-handler.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router = Router();

// List all IONOS sub-users, classified as admin / managed / external
router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const adminToken = getAdminTokenFor(req.user.email);
  const payload = decodeJwtPayload(adminToken);
  const adminUserId = payload.identity.uuid;
  const contractNumber = payload.identity.contractNumber;

  const tokenStatus = adminRenewal.getAdminTokenStatus(req.user.email);

  const [ionosUsers, ionosTokens, managedResult] = await Promise.all([
    ionosCloud.listUsers(adminToken),
    ionosAuth.listTokens(adminToken),
    Promise.resolve(db.listManagedTokens({ limit: 100000, ownerEmail: req.user.email })),
  ]);

  // Build lookup: ionos_user_id -> managed token info
  const managedByUserId = new Map<string, { id: string; name: string; status: string }>();
  for (const t of managedResult.items) {
    managedByUserId.set(t.ionos_user_id, {
      id: t.id,
      name: t.name,
      status: t.status,
    });
  }

  const emailPattern = /^tkn-.*@c\d+\.tokenmanager\.internal$/;

  const users = ionosUsers.map((u) => {
    const isAdmin = u.id === adminUserId;
    const managed = managedByUserId.get(u.id);

    return {
      ionosUserId: u.id,
      email: u.properties.email,
      firstname: u.properties.firstname,
      lastname: u.properties.lastname,
      admin: u.properties.administrator,
      active: u.properties.active,
      createdDate: u.metadata?.createdDate ?? null,
      ...(isAdmin
        ? {
            category: 'admin' as const,
            adminTokenStatus: {
              expiresAt: tokenStatus.expiresAt,
              daysRemaining: tokenStatus.daysRemaining,
              lastUpdatedAt: tokenStatus.lastUpdatedAt,
            },
          }
        : managed
          ? {
              category: 'managed' as const,
              managedTokenId: managed.id,
              managedTokenName: managed.name,
              managedTokenStatus: managed.status,
            }
          : {
              category: 'external' as const,
              possiblyFormerManaged: emailPattern.test(u.properties.email),
            }),
    };
  });

  // Sort: admin first, managed, external last
  const order = { admin: 0, managed: 1, external: 2 };
  users.sort((a, b) => order[a.category] - order[b.category]);

  const summary = {
    total: users.length,
    admin: users.filter((u) => u.category === 'admin').length,
    managed: users.filter((u) => u.category === 'managed').length,
    external: users.filter((u) => u.category === 'external').length,
  };

  // Identify orphan tokens (admin-account tokens not used by this tool)
  const adminTokenId = tokenStatus.tokenId;
  const managedIonosTokenIds = new Set(
    managedResult.items.map((t) => t.ionos_token_id).filter(Boolean),
  );

  const orphanTokens = ionosTokens
    .filter((t) => t.id !== adminTokenId && !managedIonosTokenIds.has(t.id))
    .map((t) => ({
      tokenId: t.id,
      createdDate: t.createdDate,
      expirationDate: t.expirationDate,
      expired: new Date(t.expirationDate) <= new Date(),
    }));

  res.json({
    success: true,
    data: {
      contractNumber,
      adminUserId,
      users,
      summary,
      orphanTokens,
    },
  });
}));

// Delete an external (unmanaged) user from IONOS
router.delete('/external-users/:userId', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.params.userId as string;
  const adminToken = getAdminTokenFor(req.user.email);
  const payload = decodeJwtPayload(adminToken);

  if (userId === payload.identity.uuid) {
    throw new AppError('Cannot delete the admin user', 'FORBIDDEN', 403);
  }

  // Check if this user is managed by the tool
  const managed = db.listManagedTokens({ limit: 100000, ownerEmail: req.user.email });
  const isManaged = managed.items.some((t) => t.ionos_user_id === userId);
  if (isManaged) {
    throw new AppError(
      'This is a managed user. Delete it from the Dashboard instead.',
      'VALIDATION_ERROR',
      400,
    );
  }

  await ionosCloud.deleteUser(adminToken, userId);
  db.insertAuditLog({ action: 'account.delete_external_user', entityType: 'user', entityId: userId, actorEmail: req.user.email });

  res.json({ success: true, data: { message: 'User deleted from IONOS' } });
}));

export default router;
