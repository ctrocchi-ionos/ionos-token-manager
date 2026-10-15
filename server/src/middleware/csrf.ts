import type { Request, Response, NextFunction } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks cross-site form posts riding on the SSO cookie. Browsers cannot add a custom
 * header cross-site without a CORS preflight, and this server answers no preflights.
 */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || req.headers['x-requested-with'] === 'token-manager') {
    next();
    return;
  }
  res.status(403).json({ success: false, error: { code: 'CSRF_CHECK_FAILED', message: 'Missing X-Requested-With header' } });
}
