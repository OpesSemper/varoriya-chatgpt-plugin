import type { AuthMode } from "../config.js";

export interface HeaderReader {
  get(name: string): string | null;
}

export type HeaderRecord = Readonly<
  Record<string, string | readonly string[] | undefined>
>;
export type RequestHeaders = HeaderReader | HeaderRecord;

export interface AuthContext {
  readonly mode: AuthMode;
  /** Stable Varoriya resource-owner identifier. */
  readonly userId: string;
  /** OAuth subject or fixed development principal. */
  readonly subject: string;
  readonly scopes: ReadonlySet<string>;
  readonly tokenId?: string;
  readonly expiresAtEpochSeconds?: number;
}

export interface Authenticator {
  authenticate(headers: RequestHeaders): Promise<AuthContext>;
}

function isHeaderReader(headers: RequestHeaders): headers is HeaderReader {
  return typeof (headers as HeaderReader).get === "function";
}

/** Read one header without coupling authentication to an HTTP framework. */
export function readHeader(
  headers: RequestHeaders,
  name: string,
): string | readonly string[] | undefined {
  if (isHeaderReader(headers)) return headers.get(name) ?? undefined;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}
