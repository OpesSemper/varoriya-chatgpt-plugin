/** Stable public error identifiers for the gateway and tool boundary. */
export const ERROR_CODES = [
  "INVALID_INPUT",
  "AUTH_REQUIRED",
  "INVALID_TOKEN",
  "INSUFFICIENT_SCOPE",
  "RESOURCE_FORBIDDEN",
  "INVALID_QUOTE",
  "PRICE_CHANGED",
  "INSUFFICIENT_BALANCE",
  "UNSUPPORTED_MODEL",
  "RATE_LIMITED",
  "COST_LIMIT_EXCEEDED",
  "UNSAFE_URL",
  "UNSUPPORTED_MEDIA_TYPE",
  "PAYLOAD_TOO_LARGE",
  "PROVIDER_UNAVAILABLE",
  "JOB_NOT_FOUND",
  "CONFIG_INVALID",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export type PublicErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface PublicErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly request_id?: string;
  readonly details?: PublicErrorDetails;
}

export interface AppErrorOptions {
  readonly status: number;
  /** Safe for an untrusted caller; never put secrets or raw user content here. */
  readonly message: string;
  readonly recoverable?: boolean;
  /** Allowlisted metadata only. */
  readonly details?: PublicErrorDetails;
  /** Internal only and never emitted by `toPublicBody`. */
  readonly cause?: unknown;
}

/** Stable typed error at the public trust boundary. */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly recoverable: boolean;
  public readonly details: PublicErrorDetails | undefined;
  public readonly internalCause: unknown;

  public constructor(code: ErrorCode, options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = code;
    this.status = options.status;
    this.recoverable = options.recoverable ?? false;
    this.details = options.details
      ? Object.freeze({ ...options.details })
      : undefined;
    this.internalCause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toPublicBody(requestId?: string): PublicErrorBody {
    return Object.freeze({
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      ...(requestId ? { request_id: requestId } : {}),
      ...(this.details ? { details: this.details } : {}),
    });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Convert an unexpected failure without exposing its cause. */
export function asAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  return new AppError("INTERNAL_ERROR", {
    status: 500,
    message: "The request could not be completed.",
    recoverable: true,
    cause: value,
  });
}

export function invalidInput(
  message: string,
  details?: PublicErrorDetails,
): AppError {
  return new AppError("INVALID_INPUT", {
    status: 400,
    message,
    ...(details ? { details } : {}),
  });
}
