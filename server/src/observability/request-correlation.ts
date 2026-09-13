import { randomUUID } from "node:crypto";

/**
 * Correlation identifiers are deliberately opaque: never derive them from a
 * subject, bearer token, prompt, or provider request body.
 */
export interface RequestCorrelation {
  readonly requestId: string;
  readonly receivedRequestId?: string;
}

export type RequestIdGenerator = () => string;

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function createRequestCorrelation(
  supplied: string | readonly string[] | undefined,
  generate: RequestIdGenerator = randomUUID,
): RequestCorrelation {
  const header = typeof supplied === "string" ? supplied.trim() : undefined;
  if (header && SAFE_REQUEST_ID.test(header)) {
    return Object.freeze({ requestId: header, receivedRequestId: header });
  }
  return Object.freeze({ requestId: generate() });
}

/** Used when propagating an ID to a trusted downstream request. */
export function correlationHeaders(
  correlation: RequestCorrelation,
): Readonly<Record<"x-request-id", string>> {
  return Object.freeze({ "x-request-id": correlation.requestId });
}
