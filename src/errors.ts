export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    statusCode = 500,
    options: { details?: unknown; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

/** Fetch implementations do not all use the same AbortError class. */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === 'AbortError' || value.code === 'ABORT_ERR';
}

export function errorResponse(error: unknown): {
  ok: false;
  error: string;
  details?: unknown;
  retryable?: boolean;
} {
  if (error instanceof AppError) {
    return {
      ok: false,
      error: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.retryable ? { retryable: true } : {}),
    };
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}
