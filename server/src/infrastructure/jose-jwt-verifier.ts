import { createRemoteJWKSet, jwtVerify } from "jose";

import type {
  JwtVerificationRequest,
  JwtVerifier,
  VerifiedJwt,
} from "../auth/oauth.js";
import { AppError } from "../errors.js";

/** JOSE/JWKS verifier used by the OAuth authenticator at the gateway boundary. */
export class JoseJwtVerifier implements JwtVerifier {
  private readonly keySet: ReturnType<typeof createRemoteJWKSet>;

  public constructor(jwksUri: string) {
    let uri: URL;
    try {
      uri = new URL(jwksUri);
    } catch {
      throw invalidConfiguration();
    }
    if (uri.protocol !== "https:" || uri.username || uri.password || uri.hash) {
      throw invalidConfiguration();
    }
    this.keySet = createRemoteJWKSet(uri, {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
      timeoutDuration: 5_000,
    });
  }

  public async verify(
    token: string,
    request: JwtVerificationRequest,
  ): Promise<VerifiedJwt> {
    const result = await jwtVerify(token, this.keySet, {
      issuer: request.issuer,
      audience: Array.from(request.audiences),
      algorithms: Array.from(request.allowedAlgorithms),
      clockTolerance: request.clockToleranceSeconds,
      currentDate: new Date(request.nowEpochSeconds * 1_000),
      requiredClaims: ["iss", "aud", "sub", "exp"],
    });
    const algorithm = result.protectedHeader.alg;
    if (!algorithm) throw invalidConfiguration();
    return Object.freeze({
      algorithm,
      claims: Object.freeze({ ...result.payload }),
    });
  }
}

function invalidConfiguration(): AppError {
  return new AppError("CONFIG_INVALID", {
    status: 500,
    message: "The OAuth JWKS verifier is not configured safely.",
  });
}
