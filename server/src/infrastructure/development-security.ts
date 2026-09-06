import { createHash } from "node:crypto";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import {
  CostLimiter,
  InMemoryCostLimitStore,
} from "../policy/cost-limit.js";
import { GenerationSecurityGuards } from "../policy/generation-guards.js";
import {
  IdempotencyPolicy,
  InMemoryIdempotencyStore,
} from "../policy/idempotency.js";
import { ModelAllowlistPolicy } from "../policy/model.js";
import { InMemoryOwnershipStore, OwnershipPolicy } from "../policy/ownership.js";
import {
  QuoteValidationPolicy,
  type QuoteVerifier,
  type VerifiedQuoteClaims,
} from "../policy/quote.js";
import { ScopePolicy } from "../policy/scope.js";
import {
  UploadValidationPolicy,
  type MalwareScanner,
} from "../policy/upload.js";
import type { ModelPolicyConfig, RuntimeConfig } from "../runtime.js";
import type {
  AuthenticatedRequestContext,
  GenerationJob,
  GenerationQuote,
  Money,
  RequestContext,
  UploadedFile,
  UploadInput,
} from "../types/varoriya.js";

export interface DevelopmentSecurity {
  readonly guards: GenerationSecurityGuards;
  readonly isModelAllowed: ModelAllowlistPolicy["isAllowed"];
  validateGenerationParameters(
    context: AuthenticatedRequestContext,
    model: string,
    kind: "image" | "video" | "audio",
    parameters: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>>;
  validateUpload(
    context: AuthenticatedRequestContext,
    input: UploadInput,
  ): Promise<void>;
  recordQuote(
    context: RequestContext,
    quote: GenerationQuote,
    parameters: Readonly<Record<string, unknown>>,
  ): void;
  recordUploadedFile(context: RequestContext, file: UploadedFile): void;
  recordJob(context: RequestContext, job: GenerationJob): void;
}

/**
 * Safe single-process adapters for local development and tests.
 * Production construction is rejected because persistence and malware scanning
 * must be supplied by real shared services before deployment.
 */
export function createDevelopmentSecurity(
  appConfig: AppConfig,
  runtime: RuntimeConfig,
): DevelopmentSecurity {
  if (appConfig.environment === "production") {
    throw new AppError("CONFIG_INVALID", {
      status: 500,
      message:
        "Production security adapters are not configured. Supply durable quote, ownership, idempotency, cost, and malware-scanning services.",
    });
  }

  const ownershipStore = new InMemoryOwnershipStore(appConfig.environment);
  const quoteStore = new DevelopmentQuoteStore(
    new CostLimiter(
      appConfig.cost,
      new InMemoryCostLimitStore(appConfig.environment),
    ),
  );
  const guards = new GenerationSecurityGuards({
    scopes: new ScopePolicy(),
    quotes: new QuoteValidationPolicy(quoteStore),
    idempotency: new IdempotencyPolicy(
      new InMemoryIdempotencyStore(appConfig.environment),
    ),
    ownership: new OwnershipPolicy(ownershipStore),
  });
  const modelPolicy = new ModelAllowlistPolicy(runtime.modelPolicies);
  const uploadPolicy = new UploadValidationPolicy(
    appConfig.media,
    new DevelopmentSignatureScanner(appConfig.environment),
  );

  return Object.freeze({
    guards,
    isModelAllowed: modelPolicy.isAllowed.bind(modelPolicy),
    validateGenerationParameters: (
      context: AuthenticatedRequestContext,
      model: string,
      kind: "image" | "video" | "audio",
      parameters: Readonly<Record<string, unknown>>,
    ) => validateParameters(runtime.modelPolicies, context, model, kind, parameters),
    validateUpload: (context: AuthenticatedRequestContext, input: UploadInput) =>
      uploadPolicy.validate(context, input),
    recordQuote: (
      context: RequestContext,
      quote: GenerationQuote,
      parameters: Readonly<Record<string, unknown>>,
    ) => {
      const canonical = validateParameters(
        runtime.modelPolicies,
        context,
        quote.model,
        quote.kind,
        parameters,
      );
      if (
        quote.parameters &&
        JSON.stringify(canonical) !== JSON.stringify(canonicalJson(quote.parameters, 0))
      ) {
        throw invalidQuote();
      }
      quoteStore.record(authenticatedSubject(context), quote, canonical);
    },
    recordUploadedFile: (context: RequestContext, file: UploadedFile) => {
      ownershipStore.bindFile(file.file_id, authenticatedSubject(context));
    },
    recordJob: (context: RequestContext, job: GenerationJob) => {
      ownershipStore.bindJob(job.job_id, authenticatedSubject(context));
    },
  });
}

interface StoredQuote extends VerifiedQuoteClaims {
  readonly token: string;
  readonly maxCost: Money;
}

class DevelopmentQuoteStore implements QuoteVerifier {
  private readonly records = new Map<string, StoredQuote>();

  public constructor(private readonly costLimiter: CostLimiter) {}

  public record(
    subject: string,
    quote: GenerationQuote,
    parameters: Readonly<Record<string, unknown>>,
  ): void {
    const expiresAtEpochSeconds = Math.floor(Date.parse(quote.expires_at) / 1_000);
    if (!Number.isSafeInteger(expiresAtEpochSeconds)) throw invalidQuote();
    this.removeExpired(Math.floor(Date.now() / 1_000));
    if (this.records.size >= 25_000) {
      throw new AppError("PROVIDER_UNAVAILABLE", {
        status: 503,
        message: "Quote validation is temporarily unavailable.",
        recoverable: true,
      });
    }
    const quoteId = digest(quote.quote_token);
    this.records.set(
      quote.quote_token,
      Object.freeze({
        token: quote.quote_token,
        quoteId,
        subject,
        model: quote.model,
        kind: quote.kind,
        parameters,
        expiresAtEpochSeconds,
        maxCost: Object.freeze({ ...quote.estimated_cost }),
      }),
    );
  }

  public async verify(
    token: string,
    nowEpochSeconds: number,
  ): Promise<VerifiedQuoteClaims> {
    this.removeExpired(nowEpochSeconds);
    const quote = this.records.get(token);
    if (!quote || quote.expiresAtEpochSeconds <= nowEpochSeconds) {
      throw invalidQuote();
    }
    await this.costLimiter.reserve({
      userId: quote.subject,
      requestId: quote.quoteId,
      reservationKey: quote.quoteId,
      costUnits: moneyToMicros(quote.maxCost),
    });
    return quote;
  }

  private removeExpired(nowEpochSeconds: number): void {
    for (const [token, quote] of this.records) {
      if (quote.expiresAtEpochSeconds <= nowEpochSeconds) this.records.delete(token);
    }
  }
}

/** Development scanner only verifies that prior byte-signature validation ran. */
class DevelopmentSignatureScanner implements MalwareScanner {
  public constructor(environment: AppConfig["environment"]) {
    if (environment === "production") {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "The development media scanner is disabled in production.",
      });
    }
  }

  public async scan(): Promise<{ readonly verdict: "clean" }> {
    return Object.freeze({ verdict: "clean" });
  }
}

function validateParameters(
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

function canonicalJson(value: unknown, depth: number): unknown {
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

function moneyToMicros(money: Money): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/.exec(money.amount);
  if (!match || !/^[A-Z]{3}$/.test(money.currency)) throw invalidQuote();
  const wholePart = match[1];
  if (wholePart === undefined) throw invalidQuote();
  const fractionRaw = match[2] ?? "";
  const firstSix = fractionRaw.padEnd(6, "0").slice(0, 6);
  const roundUp = /[1-9]/.test(fractionRaw.slice(6)) ? 1n : 0n;
  const value =
    BigInt(wholePart) * 1_000_000n + BigInt(firstSix || "0") + roundUp;
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidQuote();
  return Number(value);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function authenticatedSubject(context: RequestContext): string {
  if (!context.subject) {
    throw new AppError("AUTH_REQUIRED", {
      status: 401,
      message: "Authentication is required.",
    });
  }
  return context.subject;
}

function invalidParameter(): AppError {
  return new AppError("INVALID_INPUT", {
    status: 400,
    message: "A generation parameter is invalid.",
  });
}

function invalidQuote(): AppError {
  return new AppError("INVALID_QUOTE", {
    status: 400,
    message: "The quote is invalid or has expired. Request a new quote.",
  });
}

function unsupportedModel(): AppError {
  return new AppError("UNSUPPORTED_MODEL", {
    status: 422,
    message: "The selected model is not supported for this request.",
  });
}
