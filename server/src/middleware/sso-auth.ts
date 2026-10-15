import { timingSafeEqual } from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';

const EMAIL_RE = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;

function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Identity comes from the marketplace login in X-Auth-Email.
 * - If PROXY_SECRET is set (optional), the proxy must also send it as X-Proxy-Secret.
 * - The value must be exactly one email.
 * - DEV_AUTH_EMAIL is only honoured when ALLOW_DEV_AUTH=1 (set by `npm run dev` / ./start-dev.sh).
 */
export function ssoAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.proxySecret && !secretMatches(req.headers['x-proxy-secret'] as string | undefined, config.proxySecret)) {
    console.warn(`[Auth] Rejected request without valid proxy secret: ${req.method} ${req.path} from ${req.ip}`);
    deny(res, 401, 'UNAUTHORIZED', 'Invalid or missing proxy credentials');
    return;
  }

  const header = (req.headers['x-auth-email'] as string | undefined)?.trim();
  const devEmail = process.env.ALLOW_DEV_AUTH === '1' ? process.env.DEV_AUTH_EMAIL?.trim() : undefined;
  const email = (header || devEmail || '').toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    deny(res, 401, 'UNAUTHORIZED', 'Missing or invalid X-Auth-Email header');
    return;
  }

  req.user = { email };
  next();
}

export interface AuthConfigCheck {
  proxySecret: string;
  devAuth: boolean;
  nodeEnv: string | undefined;
}

/** Called once at startup: refuse the two configurations that would be clearly unsafe. */
export function assertSafeAuthConfig(opts: AuthConfigCheck = {
  proxySecret: config.proxySecret,
  devAuth: process.env.ALLOW_DEV_AUTH === '1',
  nodeEnv: process.env.NODE_ENV,
}): void {
  if (opts.devAuth && opts.nodeEnv === 'production') {
    throw new Error('Refusing to start: ALLOW_DEV_AUTH=1 is for local development only.');
  }
  // Failed proxy checks are not rate-limited (limits are per signed-in user), so a secret must be unguessable.
  if (opts.proxySecret && opts.proxySecret.length < 32) {
    throw new Error('Refusing to start: PROXY_SECRET, when used, must be at least 32 characters (e.g. `openssl rand -hex 32`).');
  }
}
