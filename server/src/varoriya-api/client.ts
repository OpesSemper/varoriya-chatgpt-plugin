import type {
  AccountBalance,
  GenerationJob,
  GenerationKind,
  GenerationQuote,
  JobStatus,
  Money,
  ModelPricing,
  PricingCatalog,
  RequestContext,
  ToolErrorCode,
  UploadedFile,
} from "../types/varoriya.js";

const DEFAULT_BASE_URL = "https://api.varoriya.com";

export interface VaroriyaApiClientOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export interface ApiGenerationRequest {
  readonly model: string;
  readonly prompt: string;
  readonly quote_token: string;
  readonly idempotency_key: string;
  readonly input_file_ids?: readonly string[];
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface ApiUploadRequest {
  readonly filename: string;
  readonly mime_type: string;
  readonly content_base64: string;
}

export class VaroriyaApiError extends Error {
  public constructor(
    public readonly code: ToolErrorCode,
    public readonly requestId: string,
    public readonly recoverable: boolean,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "VaroriyaApiError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thin typed adapter. It deliberately performs no retries; generation POSTs
 * can consume credit and may only be replayed through the idempotency ledger.
 */
export class VaroriyaApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: VaroriyaApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("A fetch implementation is required for VaroriyaApiClient");
    }
  }

  public getPricing(context: RequestContext): Promise<PricingCatalog> {
    return this.request(context, "GET", "/v1/pricing", undefined, parsePricingCatalog);
  }

  public getModelPricing(context: RequestContext, model: string): Promise<ModelPricing> {
    return this.request(
      context,
      "GET",
      `/v1/pricing/${encodeURIComponent(model)}`,
      undefined,
      parseModelPricing,
    );
  }

  public quoteGeneration(
    context: RequestContext,
    payload: {
      readonly model: string;
      readonly kind: GenerationKind;
      readonly parameters: Readonly<Record<string, unknown>>;
    },
  ): Promise<GenerationQuote> {
    return this.request(context, "POST", "/v1/pricing/quote", payload, parseQuote);
  }

  public getMe(context: RequestContext): Promise<AccountBalance> {
    return this.request(context, "GET", "/v1/me", undefined, parseBalance);
  }

  /** JSON upload abstraction; replace this method only if Varoriya uses presigned uploads. */
  public uploadFile(context: RequestContext, payload: ApiUploadRequest): Promise<UploadedFile> {
    return this.request(context, "POST", "/v1/files", payload, parseUploadedFile);
  }

  public generate(
    context: RequestContext,
    kind: GenerationKind,
    payload: ApiGenerationRequest,
  ): Promise<GenerationJob> {
    return this.request(
      context,
      "POST",
      `/v1/generate/${kind}`,
      payload,
      parseJob,
      { "Idempotency-Key": payload.idempotency_key },
    );
  }

  public getJob(context: RequestContext, jobId: string): Promise<GenerationJob> {
    return this.request(context, "GET", `/v1/jobs/${encodeURIComponent(jobId)}`, undefined, parseJob);
  }

  private async request<T>(
    context: RequestContext,
    method: "GET" | "POST",
    path: string,
    body: unknown,
    parse: (value: unknown, requestId: string) => T,
    extraHeaders?: Readonly<Record<string, string>>,
  ): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Request-Id": context.requestId,
    };

    if (context.accessToken) headers.Authorization = `Bearer ${context.accessToken}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    Object.assign(headers, extraHeaders);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
      });
      const responseRequestId =
        response.headers.get("x-request-id") ?? context.requestId;
      const payload = await readJson(response);
      if (!response.ok) {
        throw mapApiFailure(response.status, payload, responseRequestId);
      }
      return parse(payload, responseRequestId);
    } catch (error) {
      if (error instanceof VaroriyaApiError) throw error;
      if (isAbortError(error)) {
        throw new VaroriyaApiError(
          "PROVIDER_UNAVAILABLE",
          context.requestId,
          true,
          "The Varoriya service did not respond in time. Please try again.",
        );
      }
      throw new VaroriyaApiError(
        "PROVIDER_UNAVAILABLE",
        context.requestId,
        true,
        "The Varoriya service is temporarily unavailable. Please try again.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function mapApiFailure(status: number, payload: unknown, requestId: string): VaroriyaApiError {
  const providerCode = readErrorCode(payload);
  const code: ToolErrorCode = providerCode && isToolErrorCode(providerCode)
    ? providerCode
    : status === 401 ? "AUTH_REQUIRED"
      : status === 403 ? "RESOURCE_FORBIDDEN"
        : status === 404 ? "JOB_NOT_FOUND"
          : status === 409 ? "PRICE_CHANGED"
            : status === 422 || status === 400 ? "INVALID_INPUT"
              : status === 429 ? "RATE_LIMITED"
                : "PROVIDER_UNAVAILABLE";
  const safeMessages: Record<ToolErrorCode, string> = {
    INVALID_INPUT: "The request is invalid. Check the supplied values and try again.",
    AUTH_REQUIRED: "Authentication is required to use this tool.",
    INVALID_TOKEN: "The supplied token is invalid or expired.",
    INSUFFICIENT_SCOPE: "Your account is not authorized for this action.",
    RESOURCE_FORBIDDEN: "You are not allowed to access this resource.",
    INVALID_QUOTE: "The quote is invalid or has expired. Request a new quote.",
    PRICE_CHANGED: "The live price changed. Request a new quote before confirming.",
    INSUFFICIENT_BALANCE: "Your available credit is insufficient for this request.",
    UNSUPPORTED_MODEL: "The selected model is not supported for this request.",
    RATE_LIMITED: "Too many requests were made. Please try again shortly.",
    PROVIDER_UNAVAILABLE: "The Varoriya service is temporarily unavailable. Please try again.",
    JOB_NOT_FOUND: "The requested job was not found.",
  };
  return new VaroriyaApiError(
    code,
    requestId,
    code === "RATE_LIMITED" || code === "PROVIDER_UNAVAILABLE",
    safeMessages[code],
    status,
  );
}

function parsePricingCatalog(value: unknown, requestId: string): PricingCatalog {
  const unwrapped = unwrapEnvelope(value);
  const data = record(unwrapped);
  const rawModels = Array.isArray(unwrapped) ? unwrapped : data.models;
  const models = Array.isArray(rawModels)
    ? rawModels.map((entry) => parseModelPricing(entry, requestId))
    : [];
  if (models.length === 0) invalidResponse(requestId);
  const updatedAt = optionalString(data.updated_at);
  return { models, ...(updatedAt === undefined ? {} : { updated_at: updatedAt }) };
}

function parseModelPricing(value: unknown, requestId: string): ModelPricing {
  const data = record(unwrapEnvelope(value));
  const id = requiredString(data.id ?? data.model, requestId);
  const capabilities = Array.isArray(data.capabilities)
    ? data.capabilities.filter(isGenerationKind)
    : [];
  if (capabilities.length === 0) invalidResponse(requestId);
  const displayName = optionalString(data.display_name);
  const limits = isRecord(data.limits) ? scalarRecord(data.limits) : undefined;
  const pricing = isRecord(data.pricing) ? data.pricing : undefined;
  return {
    id,
    capabilities,
    ...(displayName === undefined ? {} : { display_name: displayName }),
    ...(limits === undefined ? {} : { limits }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseQuote(value: unknown, requestId: string): GenerationQuote {
  const data = record(unwrapEnvelope(value));
  const parameters = isRecord(data.parameters) ? data.parameters : undefined;
  return {
    quote_token: requiredString(data.quote_token, requestId),
    model: requiredString(data.model, requestId),
    kind: requiredGenerationKind(data.kind, requestId),
    estimated_cost: parseMoney(data.estimated_cost ?? data.cost, requestId),
    expires_at: requiredString(data.expires_at, requestId),
    ...(parameters === undefined ? {} : { parameters }),
  };
}

function parseBalance(value: unknown, requestId: string): AccountBalance {
  const data = record(unwrapEnvelope(value));
  const accountId = optionalString(data.account_id);
  return {
    balance: parseMoney(data.balance ?? data.credit_balance, requestId),
    ...(accountId === undefined ? {} : { account_id: accountId }),
  };
}

function parseUploadedFile(value: unknown, requestId: string): UploadedFile {
  const data = record(unwrapEnvelope(value));
  const status = optionalString(data.status);
  const mimeType = optionalString(data.mime_type);
  const sizeBytes = optionalFiniteNumber(data.size_bytes);
  const expiresAt = optionalString(data.expires_at);
  return {
    file_id: requiredString(data.file_id ?? data.id, requestId),
    ...(status === undefined ? {} : { status }),
    ...(mimeType === undefined ? {} : { mime_type: mimeType }),
    ...(sizeBytes === undefined ? {} : { size_bytes: sizeBytes }),
    ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
  };
}

function parseJob(value: unknown, requestId: string): GenerationJob {
  const data = record(unwrapEnvelope(value));
  const status = normalizeJobStatus(data.status, requestId);
  const quotedCost = hasValue(data.quoted_cost) ? parseMoney(data.quoted_cost, requestId) : undefined;
  const finalCost = hasValue(data.final_cost) ? parseMoney(data.final_cost, requestId) : undefined;
  const resultUrls = status === "completed" && Array.isArray(data.result_urls)
    ? safeHttpsUrls(data.result_urls)
    : undefined;
  const resultUrlExpiresAt = status === "completed"
    ? optionalString(data.result_url_expires_at)
    : undefined;
  return {
    job_id: requiredString(data.job_id ?? data.id, requestId),
    status,
    model: requiredString(data.model, requestId),
    ...(quotedCost === undefined ? {} : { quoted_cost: quotedCost }),
    ...(finalCost === undefined ? {} : { final_cost: finalCost }),
    ...(resultUrls === undefined ? {} : { result_urls: resultUrls }),
    ...(resultUrlExpiresAt === undefined ? {} : { result_url_expires_at: resultUrlExpiresAt }),
    next_action: defaultNextAction(status),
  };
}

function parseMoney(value: unknown, requestId: string): Money {
  const data = record(value);
  return {
    amount: requiredString(data.amount, requestId),
    currency: requiredString(data.currency, requestId),
  };
}

function defaultNextAction(status: JobStatus): string {
  if (status === "completed") return "Use result_urls before they expire.";
  if (status === "failed" || status === "cancelled") {
    return "This job did not complete. Request a new quote before creating another job.";
  }
  return "Call get_job with this job_id to check progress.";
}

function normalizeJobStatus(value: unknown, requestId: string): JobStatus {
  switch (value) {
    case "queued":
    case "pending":
      return "queued";
    case "running":
    case "processing":
      return "running";
    case "done":
    case "completed":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return invalidResponse(requestId);
  }
}

function safeHttpsUrls(values: readonly unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:") result.push(parsed.toString());
    } catch {
      // Invalid or non-HTTPS provider URLs are omitted from public output.
    }
  }
  return result;
}

function unwrapEnvelope(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function requiredString(value: unknown, requestId: string): string {
  if (typeof value !== "string" || value.length === 0) invalidResponse(requestId);
  return value;
}

function requiredGenerationKind(value: unknown, requestId: string): GenerationKind {
  if (!isGenerationKind(value)) invalidResponse(requestId);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function scalarRecord(value: Record<string, unknown>): Record<string, number | string | boolean> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => ["string", "number", "boolean"].includes(typeof item)),
  ) as Record<string, number | string | boolean>;
}

function readString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function readErrorCode(value: unknown): string | undefined {
  const rootCode = readString(value, "code");
  if (rootCode) return rootCode;
  return isRecord(value) ? readString(value.error, "code") : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGenerationKind(value: unknown): value is GenerationKind {
  return value === "image" || value === "video" || value === "audio";
}

function isToolErrorCode(value: string): value is ToolErrorCode {
  return [
    "INVALID_INPUT",
    "AUTH_REQUIRED",
    "INVALID_TOKEN",
    "INSUFFICIENT_SCOPE",
    "RESOURCE_FORBIDDEN",
    "INVALID_QUOTE",
    "PRICE_CHANGED",
    "INSUFFICIENT_BALANCE",
    "UNSUPPORTED_MODEL",
    "RATE_LIMITED",
    "PROVIDER_UNAVAILABLE",
    "JOB_NOT_FOUND",
  ].includes(value);
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function invalidResponse(requestId: string): never {
  throw new VaroriyaApiError(
    "PROVIDER_UNAVAILABLE",
    requestId,
    true,
    "The Varoriya service returned an unexpected response. Please try again.",
  );
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { name?: unknown }).name === "AbortError";
}
