import { timingSafeEqual } from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';

function deny(res: Response, code: string, message: string, status = 401): void {
  res.status(status).json({ success: false, error: { code, message } });
}

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Identity comes from the SSO proxy in the X-Auth-Email header.
 * - If PROXY_SECRET is set, the proxy must also send it as X-Proxy-Secret,
 *   so a direct hit on the port cannot spoof an identity.
 * - DEV_AUTH_EMAIL is only honoured when ALLOW_DEV_AUTH=1 (set by `npm run dev`, never by `npm start`).
 */
export function ssoAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.proxySecret && !secretMatches(req.headers['x-proxy-secret'] as string | undefined, config.proxySecret)) {
    console.warn(`[Auth] Rejected request without valid proxy secret: ${req.method} ${req.path} from ${req.ip}`);
    deny(res, 'UNAUTHORIZED', 'Invalid or missing proxy credentials');
    return;
  }

  const header = (req.headers['x-auth-email'] as string | undefined)?.trim();
  const devEmail = process.env.ALLOW_DEV_AUTH === '1' ? process.env.DEV_AUTH_EMAIL?.trim() : undefined;
  const email = header || devEmail;
  if (!email) {
    deny(res, 'UNAUTHORIZED', 'Missing X-Auth-Email header');
    return;
  }
  req.user = { email: email.toLowerCase() };
  next();
}
