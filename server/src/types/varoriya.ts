/** Shared dependency-free contracts for the Varoriya REST adapter and MCP tools. */

export type GenerationKind = "image" | "video" | "audio";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ToolErrorCode =
  | "INVALID_INPUT"
  | "AUTH_REQUIRED"
  | "INVALID_TOKEN"
  | "INSUFFICIENT_SCOPE"
  | "RESOURCE_FORBIDDEN"
  | "INVALID_QUOTE"
  | "PRICE_CHANGED"
  | "INSUFFICIENT_BALANCE"
  | "UNSUPPORTED_MODEL"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "JOB_NOT_FOUND";

export interface ToolFailure {
  readonly ok: false;
  readonly request_id: string;
  readonly error: {
    readonly code: ToolErrorCode;
    readonly message: string;
    readonly recoverable: boolean;
  };
}

export interface ToolSuccess<T> {
  readonly ok: true;
  readonly request_id: string;
  readonly data: T;
}

export type ToolResult<T> = ToolSuccess<T> | ToolFailure;

export interface RequestContext {
  /** Opaque correlation id minted by the gateway, never accepted from tool input. */
  readonly requestId: string;
  /** Absent only for public pricing/model-discovery requests. */
  readonly subject?: string;
  /** Short-lived credential. Never log or persist it. */
  readonly accessToken?: string;
  readonly scopes: ReadonlySet<string>;
}

export interface AuthenticatedRequestContext extends RequestContext {
  readonly subject: string;
  readonly accessToken: string;
}

export interface Money {
  readonly amount: string;
  readonly currency: string;
}

export interface QuoteBinding {
  readonly subject: string;
  readonly token: string;
  readonly model: string;
  readonly kind: GenerationKind;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly expiresAt: string;
  readonly maxCost?: Money;
}

export interface GenerationGuards {
  requireScope(context: AuthenticatedRequestContext, scope: string): void | Promise<void>;
  validateQuote(
    context: AuthenticatedRequestContext,
    token: string,
    expected: Pick<QuoteBinding, "model" | "kind" | "parameters">,
  ): QuoteBinding | Promise<QuoteBinding>;
  /** Must atomically reserve or replay an idempotency key per OAuth subject. */
  acquireIdempotency(
    context: AuthenticatedRequestContext,
    key: string,
  ): IdempotencyLease | Promise<IdempotencyLease>;
  /** Must default-deny before a provider job id is used. */
  assertJobOwnership(context: AuthenticatedRequestContext, jobId: string): void | Promise<void>;
  assertFileOwnership(context: AuthenticatedRequestContext, fileIds: readonly string[]): void | Promise<void>;
}

export interface IdempotencyLease {
  /** A completed safe replay; provider submission must be skipped when present. */
  readonly replay?: GenerationJob;
  /** Persist subject/key/job/charge linkage before returning the result. */
  complete(job: GenerationJob): void | Promise<void>;
  /** Release only if provider submission definitely never happened. */
  abandonBeforeSubmission?(): void | Promise<void>;
}

export interface ModelPricing {
  readonly id: string;
  readonly display_name?: string;
  readonly capabilities: readonly GenerationKind[];
  readonly limits?: Readonly<Record<string, number | string | boolean>>;
  readonly pricing?: Readonly<Record<string, unknown>>;
}

export interface PricingCatalog {
  readonly models: readonly ModelPricing[];
  readonly updated_at?: string;
}

export interface GenerationQuote {
  readonly quote_token: string;
  readonly model: string;
  readonly kind: GenerationKind;
  readonly estimated_cost: Money;
  readonly expires_at: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface AccountBalance {
  readonly balance: Money;
  readonly account_id?: string;
}

export interface UploadedFile {
  readonly file_id: string;
  readonly status?: string;
  readonly mime_type?: string;
  readonly size_bytes?: number;
  readonly expires_at?: string;
}

export interface GenerationJob {
  readonly job_id: string;
  readonly status: JobStatus;
  readonly model: string;
  readonly quoted_cost?: Money;
  readonly final_cost?: Money;
  readonly result_urls?: readonly string[];
  readonly result_url_expires_at?: string;
  readonly next_action: string;
}

export interface ListModelsInput {
  readonly capability?: GenerationKind;
}

export interface QuoteGenerationInput {
  readonly model: string;
  readonly kind: GenerationKind;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface UploadInput {
  readonly filename: string;
  readonly mime_type: string;
  readonly content_base64: string;
}

export interface GenerateInput {
  readonly model: string;
  readonly prompt: string;
  readonly quote_token: string;
  readonly confirm: true;
  readonly idempotency_key: string;
  readonly input_file_ids?: readonly string[];
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface GetJobInput {
  readonly job_id: string;
}

export interface JsonSchema {
  readonly type: "object";
  readonly additionalProperties: false;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
}

export interface McpToolDefinition<TInput> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly openWorldHint?: boolean;
  };
  execute(input: TInput, context: RequestContext): Promise<ToolResult<unknown>>;
}
