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
import type { RuntimeConfig } from "../runtime.js";
import type {
  AuthenticatedRequestContext,
  GenerationJob,
  GenerationQuote,
  RequestContext,
  UploadedFile,
  UploadInput,
} from "../types/varoriya.js";
import {
  authenticatedSubject,
  canonicalJson,
  invalidQuote,
  moneyToMicros,
  quoteDigest,
  validateGenerationParameters,
} from "./security-values.js";

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
    appConfig.cost.currency,
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
    ) => validateGenerationParameters(
      runtime.modelPolicies,
      context,
      model,
      kind,
      parameters,
    ),
    validateUpload: (context: AuthenticatedRequestContext, input: UploadInput) =>
      uploadPolicy.validate(context, input),
    recordQuote: (
      context: RequestContext,
      quote: GenerationQuote,
      parameters: Readonly<Record<string, unknown>>,
    ) => {
      const canonical = validateGenerationParameters(
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
}

class DevelopmentQuoteStore implements QuoteVerifier {
  private readonly records = new Map<string, StoredQuote>();

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
    const quoteId = quoteDigest(quote.quote_token);
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
    reservation: {
      readonly requestId: string;
      readonly reservationKey: string;
    },
  ): Promise<VerifiedQuoteClaims> {
    this.removeExpired(nowEpochSeconds);
    const quote = this.records.get(token);
    if (!quote || quote.expiresAtEpochSeconds <= nowEpochSeconds) {
      throw invalidQuote();
    }
    const costUnits = moneyToMicros(quote.maxCost, this.expectedCurrency);
    if (costUnits > 0) {
      await this.costLimiter.reserve({
        userId: quote.subject,
        requestId: reservation.requestId,
        reservationKey: `${quote.quoteId}:${reservation.reservationKey}`,
        costUnits,
      });
    }
    return quote;
  }

  private removeExpired(nowEpochSeconds: number): void {
    for (const [token, quote] of this.records) {
      if (quote.expiresAtEpochSeconds <= nowEpochSeconds) this.records.delete(token);
    }
  }

  public constructor(
    private readonly costLimiter: CostLimiter,
    private readonly expectedCurrency = "CRD",
  ) {}
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
