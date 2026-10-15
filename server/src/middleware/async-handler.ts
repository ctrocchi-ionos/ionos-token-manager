import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { acquireWorkspace } from '../workspace/registry.js';

/**
 * Wraps an async Express route handler so rejected promises
 * are forwarded to Express error handling instead of crashing the process.
 * The user's workspace stays held until the handler finishes, even if the browser disconnects first.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
): RequestHandler {
  return (req, res, next) => {
    const hold = req.ws ? acquireWorkspace(req.ws.email) : undefined;
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next)
      .finally(() => hold?.release());
  };
}
