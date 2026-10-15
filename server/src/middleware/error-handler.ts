import axios from 'axios';
import type { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class IonosApiError extends AppError {
  constructor(message: string, public ionosStatusCode: number, public ionosRequestId?: string) {
    super(message, 'IONOS_API_ERROR', 502);
    this.name = 'IonosApiError';
  }
}

export class TokenCreationError extends AppError {
  constructor(message: string, public step: string, public rollbackResult?: unknown) {
    super(message, 'TOKEN_CREATION_FAILED', 500, { step, rollbackResult });
    this.name = 'TokenCreationError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

function ionosErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return `IONOS refused the request (HTTP ${status}). The API token of this DCD account, or the token's own `
      + 'IONOS user, may no longer be valid. If this keeps happening, replace the token in Settings.';
  }
  if (status === 404) return 'IONOS could not find this item (HTTP 404). It may have been deleted outside this app.';
  if (status === 429) return 'IONOS is limiting requests (HTTP 429). Wait a minute and try again.';
  return `IONOS returned an error (HTTP ${status}). Try again.`;
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // A call to IONOS failed and no service turned it into an AppError. It is never the browser's fault,
  // and an IONOS 401 must not look like a failed sign-in to this app: always 502, with IONOS's status.
  if (axios.isAxiosError(err)) {
    const ionosStatus = err.response?.status;
    const path = (err.config?.url ?? '').split('?')[0];
    console.warn(`[IONOS] ${err.config?.method?.toUpperCase() ?? ''} ${path} failed: ${ionosStatus ?? err.code ?? 'no response'}`);
    res.status(502).json({
      success: false,
      error: ionosStatus
        ? { code: 'IONOS_API_ERROR', message: ionosErrorMessage(ionosStatus), details: { ionosStatus } }
        : { code: 'IONOS_UNREACHABLE', message: 'Could not reach IONOS. Try again.' },
    });
    return;
  }

  // Request errors raised by Express itself (malformed JSON, body too large, badly encoded URL) carry a 4xx status.
  // IONOS errors carry one too, but were answered above.
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({
      success: false,
      error: { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', message: status === 413 ? 'Request body too large' : 'Malformed request' },
    });
    return;
  }

  console.error('Unhandled error:', err.message, err.stack);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
