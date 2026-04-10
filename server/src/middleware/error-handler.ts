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

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  console.error('Unhandled error:', err.message, err.stack);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
