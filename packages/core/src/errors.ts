/**
 * Machine-readable error codes shared by the engine (raised in SQL as HINT), the API
 * (`{ "error": { "code", "message" } }`) and the clients. The HTTP status for each code
 * is fixed here so every channel behaves the same way.
 */
export const ERROR_STATUS = {
  INVALID: 400,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_API_KEY: 401,
  FORBIDDEN: 403,
  NOT_ELIGIBLE: 403,
  MEMBER_BLOCKED: 403,
  MEMBER_NOT_LINKED: 403,
  INSUFFICIENT_SCOPE: 403,
  NOT_FOUND: 404,
  INVALID_QR: 404,
  NOT_ACTIVE: 409,
  NO_ATTEMPTS: 409,
  INSUFFICIENT_PP: 409,
  OUT_OF_STOCK: 409,
  CAP_REACHED: 409,
  ALREADY_SCANNED: 409,
  QR_EXHAUSTED: 409,
  IDEMPOTENCY_MISMATCH: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  SESSION_EXPIRED: 410,
  LIMIT_REACHED: 429,
  COOLDOWN: 429,
  VELOCITY: 429,
  RATE_LIMITED: 429,
  UPSTREAM_MEMBER_NOT_FOUND: 502,
  UPSTREAM_SERIES_NOT_FOUND: 502,
  UPSTREAM_UNAVAILABLE: 503,
  NOT_CONFIGURED: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_STATUS;
}

export function statusForCode(code: string): number {
  return isErrorCode(code) ? ERROR_STATUS[code] : 500;
}

/** Error thrown by adapters and the API layer; carries a stable code. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}
