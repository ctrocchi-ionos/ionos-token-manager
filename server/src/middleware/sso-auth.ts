import { type Request, type Response, type NextFunction } from 'express';

export function ssoAuth(req: Request, res: Response, next: NextFunction): void {
  const email = req.headers['x-auth-email'] as string | undefined;
  if (!email || email.trim() === '') {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing X-Auth-Email header' },
    });
    return;
  }
  req.user = { email: email.trim().toLowerCase() };
  next();
}
