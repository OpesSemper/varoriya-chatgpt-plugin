import { AppError, type ErrorCode } from "../errors.js";

export const TOOL_ERROR_CODES = [
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
  "PROVIDER_UNAVAILABLE",
  "JOB_NOT_FOUND",
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];
const DIRECT_CODES = new Set<string>(TOOL_ERROR_CODES);

/** Error shape the MCP/backend boundary can recognize without vendor coupling. */
export class ToolBoundaryError extends Error {
  public constructor(
    public readonly code: ToolErrorCode,
    public readonly requestId: string,
    public readonly recoverable: boolean,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ToolBoundaryError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Translate internal policy failures to the currently supported tool codes. */
export function toToolBoundaryError(
  requestId: string,
  error: unknown,
): ToolBoundaryError {
  if (error instanceof ToolBoundaryError) return error;
  if (error instanceof AppError) {
    return new ToolBoundaryError(
      mapCode(error.code),
      requestId,
      error.recoverable,
      error.message,
      error.status,
    );
  }
  return new ToolBoundaryError(
    "PROVIDER_UNAVAILABLE",
    requestId,
    true,
    "A required security control is temporarily unavailable.",
    503,
  );
}

export function isToolBoundaryError(value: unknown): value is ToolBoundaryError {
  return value instanceof ToolBoundaryError;
}

function mapCode(code: ErrorCode): ToolErrorCode {
  if (DIRECT_CODES.has(code)) return code as ToolErrorCode;
  if (code === "COST_LIMIT_EXCEEDED") return "RATE_LIMITED";
  if (
    code === "UNSAFE_URL" ||
    code === "UNSUPPORTED_MEDIA_TYPE" ||
    code === "PAYLOAD_TOO_LARGE"
  ) {
    return "INVALID_INPUT";
  }
  return "PROVIDER_UNAVAILABLE";
}
