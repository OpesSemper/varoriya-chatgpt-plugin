import { createHash } from "node:crypto";

import { AppError } from "../errors.js";
import type { ModelPolicyConfig } from "../runtime.js";
import type {
  Money,
  RequestContext,
} from "../types/varoriya.js";

export function validateGenerationParameters(
  policies: readonly ModelPolicyConfig[],
  context: RequestContext,
  model: string,
  kind: "image" | "video" | "audio",
  parameters: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const policy = policies.find(
    (candidate) =>
      candidate.model === model &&
      candidate.kinds.includes(kind) &&
      (!candidate.subjects ||
        (context.subject !== undefined && candidate.subjects.includes(context.subject))) &&
      (candidate.requiredScopes ?? []).every((scope) => context.scopes.has(scope)),
  );
  if (!policy) throw unsupportedModel();
  const keys = Object.keys(parameters);
  if (
    keys.length > 64 ||
    keys.some((key) => !policy.allowedParameterKeys.includes(key))
  ) {
    throw new AppError("INVALID_INPUT", {
      status: 400,
      message: "The generation parameters are not allowed for this model.",
    });
  }
  return Object.freeze(
    Object.fromEntries(
      keys.sort().map((key) => [key, canonicalJson(parameters[key], 0)]),
    ),
  );
}

export function canonicalJson(value: unknown, depth = 0): unknown {
  if (depth > 6) throw invalidParameter();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 8_000) throw invalidParameter();
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidParameter();
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw invalidParameter();
    return Object.freeze(value.map((item) => canonicalJson(item, depth + 1)));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 64) throw invalidParameter();
    return Object.freeze(
      Object.fromEntries(
        entries
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => {
            if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
              throw invalidParameter();
            }
            return [key, canonicalJson(item, depth + 1)];
          }),
      ),
    );
  }
  throw invalidParameter();
}

export function moneyToMicros(money: Money, expectedCurrency?: string): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/.exec(money.amount);
  if (
    !match ||
    !/^[A-Z]{3}$/.test(money.currency) ||
    (expectedCurrency !== undefined && money.currency !== expectedCurrency)
  ) {
    throw invalidQuote();
  }
  const wholePart = match[1];
  if (wholePart === undefined) throw invalidQuote();
  const fractionRaw = match[2] ?? "";
  const firstSix = fractionRaw.padEnd(6, "0").slice(0, 6);
  const roundUp = /[1-9]/.test(fractionRaw.slice(6)) ? 1n : 0n;
  const value =
    BigInt(wholePart) * 1_000_000n + BigInt(firstSix || "0") + roundUp;
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidQuote();
  }
  return Number(value);
}

export function quoteDigest(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function authenticatedSubject(context: RequestContext): string {
  if (!context.subject) {
    throw new AppError("AUTH_REQUIRED", {
      status: 401,
      message: "Authentication is required.",
    });
  }
  return context.subject;
}

export function invalidQuote(): AppError {
  return new AppError("INVALID_QUOTE", {
    status: 400,
    message: "The quote is invalid or has expired. Request a new quote.",
  });
}

function invalidParameter(): AppError {
  return new AppError("INVALID_INPUT", {
    status: 400,
    message: "A generation parameter is invalid.",
  });
}

function unsupportedModel(): AppError {
  return new AppError("UNSUPPORTED_MODEL", {
    status: 422,
    message: "The selected model is not supported for this request.",
  });
}
