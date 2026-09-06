import { AppError } from "../errors.js";
import { readHeader, type RequestHeaders } from "./types.js";

const MAX_BEARER_TOKEN_LENGTH = 16_384;
const BEARER_PATTERN = /^Bearer[\t ]+([A-Za-z0-9\-._~+/]+={0,2})$/i;

/** Extract exactly one RFC 6750 bearer credential and fail closed otherwise. */
export function extractBearerToken(headers: RequestHeaders): string {
  const value = readHeader(headers, "authorization");
  if (value === undefined || value === "") {
    throw new AppError("AUTH_REQUIRED", {
      status: 401,
      message: "Authentication is required.",
    });
  }
  if (
    typeof value !== "string" ||
    value.includes(",") ||
    value.length > MAX_BEARER_TOKEN_LENGTH ||
    /[\r\n\0]/.test(value)
  ) {
    throw invalidBearer();
  }
  const match = BEARER_PATTERN.exec(value);
  if (!match?.[1]) throw invalidBearer();
  return match[1];
}

function invalidBearer(): AppError {
  return new AppError("INVALID_TOKEN", {
    status: 401,
    message: "The access token is invalid.",
  });
}
