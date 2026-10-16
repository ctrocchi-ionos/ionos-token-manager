import { Router, type Request, type Response } from 'express';
import * as ionosCloud from '../services/ionos-cloud.js';
import * as ionosAuth from '../services/ionos-auth.js';
import * as q from '../workspace/queries.js';
import { getAccountAdminToken, toAccountResponse } from '../services/dcd-accounts.js';
import { decodeJwtPayload } from '../config.js';
import { AppError } from '../middleware/error-handler.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { requireAccount } from '../middleware/workspace.js';
import { isoUtc } from '../lib/time.js';

const router = Router();
router.use(requireAccount);

const emailPattern = /^tkn-.*@c\d+\.tokenmanager\.internal$/;

// List all IONOS sub-users of the selected DCD account, classified as admin / managed / external
router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const adminToken = getAccountAdminToken(req.ws, req.account.id);
  const account = q.getAccount(req.ws.db, req.account.id)!;
  const accountInfo = toAccountResponse(req.ws, account);
  const payload = decodeJwtPayload(adminToken);
  const adminUserId = payload.identity.uuid;

  const [ionosUsers, ionosTokens] = await Promise.all([
    ionosCloud.listUsers(adminToken),
    ionosAuth.listTokens(adminToken),
  ]);
  const managedTokens = q.listManagedTokens(req.ws.db, { accountId: req.account.id, limit: 100000 }).items;

  const managedByUserId = new Map(managedTokens.map((t) => [t.ionos_user_id, { id: t.id, name: t.name, status: t.status }]));

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
              expiresAt: account.expires_at,
              daysRemaining: accountInfo.daysRemaining,
              lastUpdatedAt: isoUtc(account.updated_at),
            },
          }
        : managed
          ? { category: 'managed' as const, managedTokenId: managed.id, managedTokenName: managed.name, managedTokenStatus: managed.status }
          : { category: 'external' as const, possiblyFormerManaged: emailPattern.test(u.properties.email) }),
    };
  });

  const order = { admin: 0, managed: 1, external: 2 };
  users.sort((a, b) => order[a.category] - order[b.category]);

  const summary = {
    total: users.length,
    admin: users.filter((u) => u.category === 'admin').length,
    managed: users.filter((u) => u.category === 'managed').length,
    external: users.filter((u) => u.category === 'external').length,
  };

  // Admin-account tokens not used by this tool
  const managedIonosTokenIds = new Set(managedTokens.map((t) => t.ionos_token_id).filter(Boolean));
  const orphanTokens = ionosTokens
    .filter((t) => t.id !== account.token_id && !managedIonosTokenIds.has(t.id))
    .map((t) => ({
      tokenId: t.id,
      createdDate: t.createdDate,
      expirationDate: t.expirationDate,
      expired: new Date(t.expirationDate) <= new Date(),
    }));

  res.json({
    success: true,
    data: { contractNumber: account.contract_number, adminUserId, users, summary, orphanTokens },
  });
}));

// Delete an external (unmanaged) user of the selected account from IONOS
router.delete('/external-users/:userId', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.params.userId as string;
  const adminToken = getAccountAdminToken(req.ws, req.account.id);
  if (userId === decodeJwtPayload(adminToken).identity.uuid) {
    throw new AppError('Cannot delete the admin user', 'FORBIDDEN', 403);
  }
  const managed = q.listManagedTokens(req.ws.db, { accountId: req.account.id, limit: 100000 }).items;
  if (managed.some((t) => t.ionos_user_id === userId)) {
    throw new AppError('This is a managed user. Delete it from the Dashboard instead.', 'VALIDATION_ERROR', 400);
  }
  // Colleagues sharing a contract each have a private workspace, so their token users look
  // "external" here. Never let one user delete another user's token sub-user.
  const target = await ionosCloud.getUser(adminToken, userId);
  if (emailPattern.test(target.properties.email)) {
    throw new AppError(
      'This user was created by the Token Manager (possibly by a colleague). Its owner must revoke it from their dashboard.',
      'FORBIDDEN', 403,
    );
  }
  await ionosCloud.deleteUser(adminToken, userId);
  q.insertAuditLog(req.ws.db, { action: 'account.delete_external_user', accountId: req.account.id, entityType: 'user', entityId: userId });
  res.json({ success: true, data: { message: 'User deleted from IONOS' } });
}));

export default router;
