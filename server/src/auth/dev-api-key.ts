import type { DevApiKeyConfig, RuntimeEnvironment } from "../config.js";
import { AppError } from "../errors.js";
import {
  readHeader,
  type AuthContext,
  type Authenticator,
  type RequestHeaders,
} from "./types.js";

/** Development-only authenticator. Construction fails in production. */
export class DevApiKeyAuthenticator implements Authenticator {
  readonly #config: DevApiKeyConfig;

  public constructor(
    environment: RuntimeEnvironment,
    config: DevApiKeyConfig,
  ) {
    if (environment === "production") {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "Development API-key authentication is disabled in production.",
      });
    }
    this.#config = config;
  }

  public async authenticate(headers: RequestHeaders): Promise<AuthContext> {
    const value = readHeader(headers, this.#config.headerName);
    if (value === undefined || value === "") {
      throw new AppError("AUTH_REQUIRED", {
        status: 401,
        message: "Authentication is required.",
      });
    }
    if (
      typeof value !== "string" ||
      value.includes(",") ||
      !this.#config.key.matches(value)
    ) {
      throw new AppError("INVALID_TOKEN", {
        status: 401,
        message: "The development credential is invalid.",
      });
    }
    return Object.freeze({
      mode: "dev-api-key" as const,
      userId: this.#config.principalId,
      subject: this.#config.principalId,
      scopes: new Set(this.#config.scopes) as ReadonlySet<string>,
    });
  }
}
