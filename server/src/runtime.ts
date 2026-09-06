import { AppError } from "./errors.js";
import type { GenerationKind } from "./types/varoriya.js";

export interface ModelPolicyConfig {
  readonly model: string;
  readonly kinds: readonly GenerationKind[];
  readonly requiredScopes?: readonly string[];
  readonly subjects?: readonly string[];
  readonly allowedParameterKeys: readonly string[];
}

export interface RuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly publicOrigin?: string;
  readonly apiBaseUrl: string;
  readonly apiTimeoutMs: number;
  readonly providerApiKey?: string;
  readonly oauthJwksUri?: string;
  readonly modelPolicies: readonly ModelPolicyConfig[];
}

export function loadRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  const environment = env.NODE_ENV?.trim() || "development";
  const publicOrigin = optionalAbsoluteUrl(env.PUBLIC_ORIGIN, "PUBLIC_ORIGIN");
  const oauthJwksUri = optionalAbsoluteUrl(
    env.VARORIYA_OAUTH_JWKS_URI,
    "VARORIYA_OAUTH_JWKS_URI",
  );
  if (environment === "production" && !publicOrigin) {
    throw configurationError("PUBLIC_ORIGIN is required in production.");
  }
  if (
    environment === "production" &&
    publicOrigin &&
    !publicOrigin.startsWith("https://")
  ) {
    throw configurationError("PUBLIC_ORIGIN must use HTTPS in production.");
  }

  return Object.freeze({
    host: env.HOST?.trim() || "127.0.0.1",
    port: integer(env.PORT, 3000, 1, 65_535, "PORT"),
    ...(publicOrigin ? { publicOrigin } : {}),
    apiBaseUrl:
      optionalAbsoluteUrl(env.VARORIYA_API_BASE_URL, "VARORIYA_API_BASE_URL") ??
      "https://api.varoriya.com",
    apiTimeoutMs: integer(
      env.VARORIYA_API_TIMEOUT_MS,
      15_000,
      1_000,
      120_000,
      "VARORIYA_API_TIMEOUT_MS",
    ),
    ...(env.VARORIYA_API_KEY?.trim()
      ? { providerApiKey: env.VARORIYA_API_KEY.trim() }
      : {}),
    ...(oauthJwksUri ? { oauthJwksUri } : {}),
    modelPolicies: parseModelPolicies(env.VARORIYA_MODEL_POLICIES_JSON),
  });
}

function parseModelPolicies(raw: string | undefined): readonly ModelPolicyConfig[] {
  if (!raw?.trim()) return Object.freeze([]);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw configurationError("VARORIYA_MODEL_POLICIES_JSON must be valid JSON.");
  }
  if (!Array.isArray(value) || value.length > 500) {
    throw configurationError("VARORIYA_MODEL_POLICIES_JSON must be an array.");
  }
  return Object.freeze(value.map(parseModelPolicy));
}

function parseModelPolicy(value: unknown): ModelPolicyConfig {
  if (!isRecord(value) || !validModel(value.model)) {
    throw configurationError("Each model policy must contain a valid model.");
  }
  const kinds = stringArray(value.kinds, "kinds");
  if (kinds.length === 0 || !kinds.every(isGenerationKind)) {
    throw configurationError("Each model policy must contain supported kinds.");
  }
  const requiredScopes = optionalStringArray(value.requiredScopes, "requiredScopes");
  const subjects = optionalStringArray(value.subjects, "subjects");
  const allowedParameterKeys = optionalStringArray(
    value.allowedParameterKeys,
    "allowedParameterKeys",
  ) ?? [];
  for (const key of allowedParameterKeys) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      throw configurationError("A model parameter allowlist entry is invalid.");
    }
  }
  return Object.freeze({
    model: value.model,
    kinds: Object.freeze(kinds as GenerationKind[]),
    ...(requiredScopes ? { requiredScopes: Object.freeze(requiredScopes) } : {}),
    ...(subjects ? { subjects: Object.freeze(subjects) } : {}),
    allowedParameterKeys: Object.freeze(allowedParameterKeys),
  });
}

function optionalAbsoluteUrl(raw: string | undefined, name: string): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = new URL(raw.trim());
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new Error("unsafe URL");
    }
    return parsed.href.replace(/\/$/, "");
  } catch {
    throw configurationError(`${name} must be a safe absolute HTTP(S) URL.`);
  }
}

function integer(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!raw?.trim()) return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw configurationError(`${name} must be an integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw configurationError(`${name} is outside its supported range.`);
  }
  return value;
}

function stringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    !value.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw configurationError(`Model policy ${name} must be a string array.`);
  }
  return Array.from(new Set(value));
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  return value === undefined ? undefined : stringArray(value, name);
}

function validModel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

function isGenerationKind(value: string): value is GenerationKind {
  return value === "image" || value === "video" || value === "audio";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configurationError(message: string): AppError {
  return new AppError("CONFIG_INVALID", { status: 500, message });
}
