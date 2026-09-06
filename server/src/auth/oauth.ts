import type { OAuthConfig } from "../config.js";
import { AppError } from "../errors.js";
import { extractBearerToken } from "./bearer.js";
import type {
  AuthContext,
  Authenticator,
  RequestHeaders,
} from "./types.js";

export type JwtClaims = Readonly<Record<string, unknown>>;

export interface JwtVerificationRequest {
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly allowedAlgorithms: readonly string[];
  readonly clockToleranceSeconds: number;
  readonly nowEpochSeconds: number;
}

export interface VerifiedJwt {
  readonly algorithm: string;
  readonly claims: JwtClaims;
}

/**
 * Cryptographic adapter supplied by the composition root. Implementations MUST
 * verify signature, issuer, audience, exp/nbf, key use, and algorithm/key
 * compatibility. JWKS discovery/cache/network behavior belongs in that adapter.
 */
export interface JwtVerifier {
  verify(
    token: string,
    request: JwtVerificationRequest,
  ): Promise<VerifiedJwt>;
}

export interface OAuthAuthenticatorOptions {
  readonly now?: () => number;
}

export class OAuthAuthenticator implements Authenticator {
  readonly #now: () => number;
  readonly #config: OAuthConfig;
  readonly #verifier: JwtVerifier;

  public constructor(
    config: OAuthConfig,
    verifier: JwtVerifier,
    options: OAuthAuthenticatorOptions = {},
  ) {
    if (!verifier || typeof verifier.verify !== "function") {
      throw configurationError();
    }
    this.#config = config;
    this.#verifier = verifier;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  }

  public async authenticate(headers: RequestHeaders): Promise<AuthContext> {
    const token = extractBearerToken(headers);
    const nowEpochSeconds = this.#now();
    let verified: VerifiedJwt;
    try {
      verified = await this.#verifier.verify(token, {
        issuer: this.#config.issuer,
        audiences: this.#config.audiences,
        allowedAlgorithms: this.#config.allowedAlgorithms,
        clockToleranceSeconds: this.#config.clockToleranceSeconds,
        nowEpochSeconds,
      });
    } catch (cause) {
      throw new AppError("INVALID_TOKEN", {
        status: 401,
        message: "The access token is invalid or expired.",
        cause,
      });
    }

    if (!this.#config.allowedAlgorithms.includes(verified.algorithm)) {
      throw invalidToken();
    }
    const { claims } = verified;
    if (
      claims.iss !== this.#config.issuer ||
      !hasExpectedAudience(claims.aud, this.#config.audiences)
    ) {
      throw invalidToken();
    }
    const subject = requiredClaimString(claims, "sub");
    const userId = requiredClaimString(
      claims,
      this.#config.resourceOwnerClaim,
    );
    const expiresAtEpochSeconds = requiredNumericDate(claims, "exp");
    if (
      expiresAtEpochSeconds + this.#config.clockToleranceSeconds <=
      nowEpochSeconds
    ) {
      throw invalidToken();
    }
    const notBefore = optionalNumericDate(claims, "nbf");
    if (
      notBefore !== undefined &&
      notBefore - this.#config.clockToleranceSeconds > nowEpochSeconds
    ) {
      throw invalidToken();
    }
    const tokenId = optionalClaimString(claims, "jti");
    return Object.freeze({
      mode: "oauth" as const,
      userId,
      subject,
      scopes: new Set(parseScopes(claims)) as ReadonlySet<string>,
      ...(tokenId ? { tokenId } : {}),
      expiresAtEpochSeconds,
    });
  }
}

function hasExpectedAudience(
  claim: unknown,
  expected: readonly string[],
): boolean {
  const actual =
    typeof claim === "string"
      ? [claim]
      : Array.isArray(claim) && claim.every((item) => typeof item === "string")
        ? (claim as string[])
        : [];
  return expected.some((audience) => actual.includes(audience));
}

function requiredClaimString(claims: JwtClaims, name: string): string {
  const value = optionalClaimString(claims, name);
  if (!value) throw invalidToken();
  return value;
}

function optionalClaimString(
  claims: JwtClaims,
  name: string,
): string | undefined {
  const value = claims[name];
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw invalidToken();
  }
  return value;
}

function requiredNumericDate(claims: JwtClaims, name: string): number {
  const value = optionalNumericDate(claims, name);
  if (value === undefined) throw invalidToken();
  return value;
}

function optionalNumericDate(
  claims: JwtClaims,
  name: string,
): number | undefined {
  const value = claims[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidToken();
  }
  return value;
}

function parseScopes(claims: JwtClaims): string[] {
  const scope = claims.scope;
  const scp = claims.scp;
  let values: string[] = [];
  if (typeof scope === "string") {
    values = scope.split(/\s+/).filter(Boolean);
  } else if (scope !== undefined) {
    throw invalidToken();
  }
  if (Array.isArray(scp) && scp.every((item) => typeof item === "string")) {
    values.push(...(scp as string[]));
  } else if (typeof scp === "string") {
    values.push(...scp.split(/\s+/).filter(Boolean));
  } else if (scp !== undefined) {
    throw invalidToken();
  }
  const unique = new Set<string>();
  for (const value of values) {
    if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value)) {
      throw invalidToken();
    }
    unique.add(value);
  }
  return Array.from(unique);
}

function invalidToken(): AppError {
  return new AppError("INVALID_TOKEN", {
    status: 401,
    message: "The access token is invalid or expired.",
  });
}

function configurationError(): AppError {
  return new AppError("CONFIG_INVALID", {
    status: 500,
    message: "OAuth authentication is not safely configured.",
  });
}
