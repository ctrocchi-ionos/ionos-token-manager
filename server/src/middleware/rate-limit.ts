import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const message = { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } };
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Everyone arrives from the SSO proxy's IP, so count per signed-in user instead.
const byUser = (req: Request) => `user:${req.user.email}`;
const common = {
  windowMs: 60_000,
  keyGenerator: byUser,
  standardHeaders: true,
  legacyHeaders: false,
  message,
  validate: { xForwardedForHeader: false },
} as const;

/** All API calls, per user. */
export const userRateLimit = rateLimit({ ...common, limit: 300 });

/** Changes (create, revoke, regenerate, ...): these call IONOS and are slow. */
export const userMutationRateLimit = rateLimit({ ...common, limit: 60, skip: (req) => SAFE_METHODS.has(req.method) });
