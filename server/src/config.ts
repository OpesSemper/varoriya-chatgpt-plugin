import { AppError } from "./errors.js";

export type RuntimeEnvironment = "development" | "test" | "production";
export type AuthMode = "oauth" | "dev-api-key";
export type EnvironmentInput = Readonly<Record<string, string | undefined>>;

const ASYMMETRIC_JWT_ALGORITHMS = new Set(["RS256", "ES256", "EdDSA"]);
const DEFAULT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
] as const;

/** Opaque secret whose ordinary string/JSON representations cannot reveal bytes. */
export class SecretValue {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  public static from(value: string): SecretValue {
    return new SecretValue(value);
  }

  /** Best-effort constant-work comparison for development credentials. */
  public matches(candidate: string): boolean {
    let difference = this.#value.length ^ candidate.length;
    const length = Math.max(this.#value.length, candidate.length);
    for (let index = 0; index < length; index += 1) {
      const expected = this.#value.charCodeAt(
        index % Math.max(this.#value.length, 1),
      );
      const actual = candidate.charCodeAt(
        index % Math.max(candidate.length, 1),
      );
      difference |= expected ^ actual;
    }
    return difference === 0;
  }

  public toString(): string {
    return "[REDACTED]";
  }

  public toJSON(): string {
    return "[REDACTED]";
  }
}

export interface OAuthConfig {
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly allowedAlgorithms: readonly string[];
  readonly resourceOwnerClaim: string;
  readonly clockToleranceSeconds: number;
}

export interface DevApiKeyConfig {
  readonly key: SecretValue;
  readonly principalId: string;
  readonly scopes: readonly string[];
  readonly headerName: string;
}

export interface CostPolicyConfig {
  /** Integer units in the smallest billable denomination. */
  readonly maxRequestCostUnits: number;
  readonly maxUserCostUnitsPerWindow: number;
  readonly windowSeconds: number;
}

export interface UrlPolicyConfig {
  readonly enabled: boolean;
  readonly allowedHosts: readonly string[];
  readonly allowedPorts: readonly number[];
  readonly maxUrlLength: number;
  readonly allowHttp: boolean;
  readonly allowPublicIpLiterals: boolean;
}

export interface MediaPolicyConfig {
  readonly allowedMimeTypes: readonly string[];
  readonly maxUploadBytes: number;
}

export interface AppConfig {
  readonly environment: RuntimeEnvironment;
  readonly authMode: AuthMode;
  readonly oauth?: OAuthConfig;
  readonly devApiKey?: DevApiKeyConfig;
  readonly cost: CostPolicyConfig;
  readonly url: UrlPolicyConfig;
  readonly media: MediaPolicyConfig;
}

class ConfigCollector {
  readonly #issues: string[] = [];

  public add(variable: string, reason: string): void {
    this.#issues.push(`${variable}: ${reason}`);
  }

  public assertValid(): void {
    if (this.#issues.length > 0) {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "Server security configuration is invalid.",
        // Only variable names and validation rules are included, never values.
        details: { fields: this.#issues.join("; ") },
      });
    }
  }
}

function readRequired(
  env: EnvironmentInput,
  name: string,
  collector: ConfigCollector,
): string {
  const value = env[name]?.trim();
  if (!value) {
    collector.add(name, "is required");
    return "";
  }
  return value;
}

function parseEnvironment(
  value: string | undefined,
  collector: ConfigCollector,
): RuntimeEnvironment {
  const normalized = value?.trim() || "development";
  if (
    normalized !== "development" &&
    normalized !== "test" &&
    normalized !== "production"
  ) {
    collector.add("NODE_ENV", "must be development, test, or production");
    return "development";
  }
  return normalized;
}

function parseInteger(
  env: EnvironmentInput,
  name: string,
  fallback: number,
  collector: ConfigCollector,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    collector.add(name, "must be an integer");
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    collector.add(name, `must be between ${minimum} and ${maximum}`);
    return fallback;
  }
  return parsed;
}

function parseBoolean(
  env: EnvironmentInput,
  name: string,
  fallback: boolean,
  collector: ConfigCollector,
): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  collector.add(name, "must be true or false");
  return fallback;
}

function parseCsv(value: string | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function parseIssuer(
  raw: string,
  environment: RuntimeEnvironment,
  collector: ConfigCollector,
): string {
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const localDevelopmentIssuer =
      environment !== "production" &&
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (parsed.protocol !== "https:" && !localDevelopmentIssuer) {
      collector.add("VARORIYA_OAUTH_ISSUER", "must use HTTPS");
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      collector.add(
        "VARORIYA_OAUTH_ISSUER",
        "must not contain credentials, query parameters, or a fragment",
      );
    }
    return parsed.href;
  } catch {
    collector.add("VARORIYA_OAUTH_ISSUER", "must be an absolute URL");
    return "";
  }
}

function validIdentity(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validScope(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value);
}

function validHostPattern(value: string): boolean {
  const hostname = value.startsWith("*.") ? value.slice(2) : value;
  if (
    hostname.length < 1 ||
    hostname.length > 253 ||
    hostname.includes("*") ||
    hostname.startsWith(".") ||
    hostname.endsWith(".")
  ) {
    return false;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return hostname
      .split(".")
      .map(Number)
      .every((part) => part >= 0 && part <= 255);
  }
  return hostname.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
  );
}

function parsePorts(
  env: EnvironmentInput,
  collector: ConfigCollector,
): readonly number[] {
  const values = parseCsv(env.VARORIYA_REMOTE_URL_ALLOWED_PORTS);
  if (values.length === 0) return Object.freeze([443]);
  const ports = values.map((value) => {
    if (!/^\d+$/.test(value)) {
      collector.add(
        "VARORIYA_REMOTE_URL_ALLOWED_PORTS",
        "must contain only integer ports",
      );
      return 443;
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      collector.add(
        "VARORIYA_REMOTE_URL_ALLOWED_PORTS",
        "ports must be between 1 and 65535",
      );
      return 443;
    }
    return port;
  });
  return Object.freeze(Array.from(new Set(ports)));
}

function parseAuth(
  env: EnvironmentInput,
  environment: RuntimeEnvironment,
  collector: ConfigCollector,
): Pick<AppConfig, "authMode" | "oauth" | "devApiKey"> {
  const rawMode = readRequired(env, "VARORIYA_AUTH_MODE", collector);
  const authMode: AuthMode = rawMode === "dev-api-key" ? "dev-api-key" : "oauth";
  if (rawMode && rawMode !== "oauth" && rawMode !== "dev-api-key") {
    collector.add("VARORIYA_AUTH_MODE", "must be oauth or dev-api-key");
  }

  if (authMode === "dev-api-key") {
    if (environment === "production") {
      collector.add(
        "VARORIYA_AUTH_MODE",
        "dev-api-key is forbidden in production",
      );
    }
    const rawKey = readRequired(env, "VARORIYA_DEV_API_KEY", collector);
    if (rawKey && (rawKey.length < 32 || rawKey.length > 256 || /\s/.test(rawKey))) {
      collector.add(
        "VARORIYA_DEV_API_KEY",
        "must be 32-256 non-whitespace characters",
      );
    }
    const principalId = readRequired(
      env,
      "VARORIYA_DEV_PRINCIPAL_ID",
      collector,
    );
    if (principalId && !validIdentity(principalId)) {
      collector.add("VARORIYA_DEV_PRINCIPAL_ID", "has an invalid identity");
    }
    const scopes = parseCsv(env.VARORIYA_DEV_SCOPES);
    if (scopes.length === 0) {
      collector.add("VARORIYA_DEV_SCOPES", "must contain at least one scope");
    } else if (scopes.some((scope) => !validScope(scope))) {
      collector.add("VARORIYA_DEV_SCOPES", "contains an invalid scope");
    }
    return {
      authMode,
      devApiKey: Object.freeze({
        key: SecretValue.from(rawKey),
        principalId,
        scopes: Object.freeze(scopes),
        headerName: "x-varoriya-dev-api-key",
      }),
    };
  }

  const rawIssuer = readRequired(env, "VARORIYA_OAUTH_ISSUER", collector);
  const audiences = parseCsv(env.VARORIYA_OAUTH_AUDIENCES);
  if (audiences.length === 0) {
    collector.add("VARORIYA_OAUTH_AUDIENCES", "must contain at least one audience");
  } else if (
    audiences.some(
      (audience) =>
        audience.length > 512 || /[\u0000-\u001f\u007f]/.test(audience),
    )
  ) {
    collector.add("VARORIYA_OAUTH_AUDIENCES", "contains an invalid audience");
  }

  const requestedAlgorithms = parseCsv(env.VARORIYA_OAUTH_ALGORITHMS);
  const allowedAlgorithms =
    requestedAlgorithms.length > 0
      ? requestedAlgorithms
      : Array.from(ASYMMETRIC_JWT_ALGORITHMS);
  if (
    allowedAlgorithms.some(
      (algorithm) => !ASYMMETRIC_JWT_ALGORITHMS.has(algorithm),
    )
  ) {
    collector.add(
      "VARORIYA_OAUTH_ALGORITHMS",
      "only RS256, ES256, and EdDSA are allowed",
    );
  }

  const resourceOwnerClaim =
    env.VARORIYA_OAUTH_RESOURCE_OWNER_CLAIM?.trim() || "sub";
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(resourceOwnerClaim)) {
    collector.add(
      "VARORIYA_OAUTH_RESOURCE_OWNER_CLAIM",
      "has an invalid claim name",
    );
  }

  return {
    authMode,
    oauth: Object.freeze({
      issuer: parseIssuer(rawIssuer, environment, collector),
      audiences: Object.freeze(audiences),
      allowedAlgorithms: Object.freeze(allowedAlgorithms),
      resourceOwnerClaim,
      clockToleranceSeconds: parseInteger(
        env,
        "VARORIYA_OAUTH_CLOCK_TOLERANCE_SECONDS",
        30,
        collector,
        0,
        300,
      ),
    }),
  };
}

/**
 * Parse explicitly supplied environment state. The composition root must call
 * this once and abort startup on `CONFIG_INVALID`; this module never reads
 * `process.env` or performs discovery/network I/O during import.
 */
export function loadConfig(env: EnvironmentInput): AppConfig {
  const collector = new ConfigCollector();
  const environment = parseEnvironment(env.NODE_ENV, collector);
  const auth = parseAuth(env, environment, collector);
  const remoteUrlsEnabled = parseBoolean(
    env,
    "VARORIYA_REMOTE_URLS_ENABLED",
    false,
    collector,
  );
  const allowHttp = parseBoolean(
    env,
    "VARORIYA_REMOTE_URL_ALLOW_HTTP",
    false,
    collector,
  );
  const allowedHosts = parseCsv(env.VARORIYA_REMOTE_URL_ALLOWED_HOSTS).map(
    (host) => host.toLowerCase(),
  );
  if (allowedHosts.some((host) => !validHostPattern(host))) {
    collector.add(
      "VARORIYA_REMOTE_URL_ALLOWED_HOSTS",
      "contains an invalid hostname pattern",
    );
  }
  if (
    environment === "production" &&
    remoteUrlsEnabled &&
    allowedHosts.length === 0
  ) {
    collector.add(
      "VARORIYA_REMOTE_URL_ALLOWED_HOSTS",
      "is required when production remote URLs are enabled",
    );
  }
  if (environment === "production" && allowHttp) {
    collector.add(
      "VARORIYA_REMOTE_URL_ALLOW_HTTP",
      "must be false in production",
    );
  }

  const allowedMimeTypes = parseCsv(env.VARORIYA_ALLOWED_MIME_TYPES).map(
    (mime) => mime.toLowerCase(),
  );
  if (
    allowedMimeTypes.some(
      (mime) =>
        !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(
          mime,
        ),
    )
  ) {
    collector.add("VARORIYA_ALLOWED_MIME_TYPES", "contains an invalid MIME type");
  }

  const cost = Object.freeze({
    maxRequestCostUnits: parseInteger(
      env,
      "VARORIYA_MAX_REQUEST_COST_UNITS",
      100_000,
      collector,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    maxUserCostUnitsPerWindow: parseInteger(
      env,
      "VARORIYA_MAX_USER_COST_UNITS_PER_WINDOW",
      500_000,
      collector,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    windowSeconds: parseInteger(
      env,
      "VARORIYA_COST_WINDOW_SECONDS",
      86_400,
      collector,
      60,
      2_592_000,
    ),
  });
  if (cost.maxRequestCostUnits > cost.maxUserCostUnitsPerWindow) {
    collector.add(
      "VARORIYA_MAX_REQUEST_COST_UNITS",
      "must not exceed the per-user window limit",
    );
  }

  const config: AppConfig = Object.freeze({
    environment,
    ...auth,
    cost,
    url: Object.freeze({
      enabled: remoteUrlsEnabled,
      allowedHosts: Object.freeze(allowedHosts),
      allowedPorts: parsePorts(env, collector),
      maxUrlLength: parseInteger(
        env,
        "VARORIYA_REMOTE_URL_MAX_LENGTH",
        2_048,
        collector,
        256,
        8_192,
      ),
      allowHttp,
      allowPublicIpLiterals: parseBoolean(
        env,
        "VARORIYA_REMOTE_URL_ALLOW_PUBLIC_IP_LITERALS",
        false,
        collector,
      ),
    }),
    media: Object.freeze({
      allowedMimeTypes: Object.freeze(
        allowedMimeTypes.length > 0
          ? allowedMimeTypes
          : Array.from(DEFAULT_MEDIA_TYPES),
      ),
      maxUploadBytes: parseInteger(
        env,
        "VARORIYA_MAX_UPLOAD_BYTES",
        50 * 1024 * 1024,
        collector,
        1_024,
        2 * 1024 * 1024 * 1024,
      ),
    }),
  });

  collector.assertValid();
  return config;
}
