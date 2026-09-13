import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { GenerationSecurityGuards } from "../policy/generation-guards.js";
import { IdempotencyPolicy } from "../policy/idempotency.js";
import { ModelAllowlistPolicy } from "../policy/model.js";
import { OwnershipPolicy } from "../policy/ownership.js";
import { QuoteValidationPolicy } from "../policy/quote.js";
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
import { PostgresCostLimitStore } from "./postgres/cost-limit-store.js";
import type { PostgresDatabase } from "./postgres/client.js";
import { PostgresIdempotencyStore } from "./postgres/idempotency-store.js";
import { PostgresOwnershipStore } from "./postgres/ownership-store.js";
import { PostgresQuoteStore } from "./postgres/quote-store.js";
import {
  authenticatedSubject,
  canonicalJson,
  invalidQuote,
  validateGenerationParameters,
} from "./security-values.js";

export interface ProductionSecurity {
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
  ): Promise<void>;
  recordUploadedFile(context: RequestContext, file: UploadedFile): Promise<void>;
  recordJob(context: RequestContext, job: GenerationJob): Promise<void>;
}

export function createProductionSecurity(
  appConfig: AppConfig,
  runtime: RuntimeConfig,
  dependencies: {
    readonly database: PostgresDatabase;
    readonly malwareScanner: MalwareScanner;
  },
): ProductionSecurity {
  if (appConfig.environment !== "production" || appConfig.authMode !== "oauth") {
    throw new AppError("CONFIG_INVALID", {
      status: 500,
      message: "Production security requires the production OAuth environment.",
    });
  }
  if (runtime.modelPolicies.length === 0) {
    throw new AppError("CONFIG_INVALID", {
      status: 500,
      message: "At least one production model policy is required.",
    });
  }

  const costStore = new PostgresCostLimitStore(dependencies.database);
  const quoteStore = new PostgresQuoteStore(
    dependencies.database,
    costStore,
    appConfig.cost,
  );
  const ownershipStore = new PostgresOwnershipStore(dependencies.database);
  const guards = new GenerationSecurityGuards({
    scopes: new ScopePolicy(),
    quotes: new QuoteValidationPolicy(quoteStore),
    idempotency: new IdempotencyPolicy(
      new PostgresIdempotencyStore(dependencies.database),
    ),
    ownership: new OwnershipPolicy(ownershipStore),
  });
  const modelPolicy = new ModelAllowlistPolicy(runtime.modelPolicies);
  const uploadPolicy = new UploadValidationPolicy(
    appConfig.media,
    dependencies.malwareScanner,
  );

  return Object.freeze({
    guards,
    isModelAllowed: modelPolicy.isAllowed.bind(modelPolicy),
    validateGenerationParameters: (
      context: AuthenticatedRequestContext,
      model: string,
      kind: "image" | "video" | "audio",
      parameters: Readonly<Record<string, unknown>>,
    ) =>
      validateGenerationParameters(
        runtime.modelPolicies,
        context,
        model,
        kind,
        parameters,
      ),
    validateUpload: (context: AuthenticatedRequestContext, input: UploadInput) =>
      uploadPolicy.validate(context, input),
    recordQuote: async (
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
        JSON.stringify(canonical) !== JSON.stringify(canonicalJson(quote.parameters))
      ) {
        throw invalidQuote();
      }
      await quoteStore.record(authenticatedSubject(context), quote, canonical);
    },
    recordUploadedFile: (context: RequestContext, file: UploadedFile) =>
      ownershipStore.bindFile(file.file_id, authenticatedSubject(context)),
    recordJob: (context: RequestContext, job: GenerationJob) =>
      ownershipStore.bindJob(job.job_id, authenticatedSubject(context)),
  });
}
