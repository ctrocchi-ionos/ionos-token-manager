import { type Request, type Response, type NextFunction } from 'express';

export function ssoAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-auth-email'] as string | undefined;
  const email = header?.trim() || process.env.DEV_AUTH_EMAIL?.trim();
  if (!email) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing X-Auth-Email header' },
    });
    return;
  }
  req.user = { email: email.toLowerCase() };
  next();
}
