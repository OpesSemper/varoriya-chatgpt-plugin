import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { DevApiKeyAuthenticator } from "./dev-api-key.js";
import { OAuthAuthenticator, type JwtVerifier } from "./oauth.js";
import type { Authenticator } from "./types.js";

export { assertResourceOwner, assertScopes } from "./authorization.js";
export { extractBearerToken } from "./bearer.js";
export { DevApiKeyAuthenticator } from "./dev-api-key.js";
export { OAuthAuthenticator } from "./oauth.js";
export type {
  JwtClaims,
  JwtVerificationRequest,
  JwtVerifier,
  VerifiedJwt,
} from "./oauth.js";
export type {
  AuthContext,
  Authenticator,
  HeaderReader,
  HeaderRecord,
  RequestHeaders,
} from "./types.js";

/** Compose authentication explicitly; OAuth cannot start without a verifier. */
export function createAuthenticator(
  config: AppConfig,
  jwtVerifier?: JwtVerifier,
): Authenticator {
  if (config.authMode === "oauth") {
    if (!config.oauth || !jwtVerifier) {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "OAuth authentication is not fully configured.",
      });
    }
    return new OAuthAuthenticator(config.oauth, jwtVerifier);
  }
  if (!config.devApiKey) {
    throw new AppError("CONFIG_INVALID", {
      status: 500,
      message: "Development authentication is not fully configured.",
    });
  }
  return new DevApiKeyAuthenticator(config.environment, config.devApiKey);
}
