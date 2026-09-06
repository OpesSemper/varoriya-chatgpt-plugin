import { VaroriyaApiClient, VaroriyaApiError } from "../varoriya-api/client.js";
import { toToolBoundaryError } from "../policy/tool-boundary-error.js";
import type {
  AuthenticatedRequestContext,
  GenerateInput,
  GenerationGuards,
  GenerationJob,
  GenerationKind,
  GetJobInput,
  ListModelsInput,
  McpToolDefinition,
  ModelPricing,
  QuoteGenerationInput,
  RequestContext,
  ToolErrorCode,
  ToolFailure,
  ToolResult,
  UploadInput,
} from "../types/varoriya.js";
import {
  generateInputSchema,
  getBalanceInputSchema,
  getJobInputSchema,
  listModelsInputSchema,
  quoteGenerationInputSchema,
  uploadInputSchema,
} from "./schemas.js";

const PUBLIC_SCOPES: ReadonlySet<string> = new Set<string>();

export interface VaroriyaToolDependencies {
  readonly client: VaroriyaApiClient;
  readonly guards: GenerationGuards;
  /** Must apply a public catalog policy when context has no OAuth subject. */
  readonly isModelAllowed: (
    context: RequestContext,
    model: string,
    kind: GenerationKind,
  ) => boolean | Promise<boolean>;
  /** Reject unknown fields/ranges and return canonical model parameters. */
  readonly validateGenerationParameters: (
    context: AuthenticatedRequestContext,
    model: string,
    kind: GenerationKind,
    parameters: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;
  /** MIME sniffing, size limits, malware checks and storage ownership binding. */
  readonly validateUpload: (
    context: AuthenticatedRequestContext,
    input: UploadInput,
  ) => void | Promise<void>;
}

export interface VaroriyaTools {
  readonly list_models: McpToolDefinition<ListModelsInput>;
  readonly quote_generation: McpToolDefinition<QuoteGenerationInput>;
  readonly get_balance: McpToolDefinition<Record<string, never>>;
  readonly upload_input: McpToolDefinition<UploadInput>;
  readonly generate_image: McpToolDefinition<GenerateInput>;
  readonly generate_video: McpToolDefinition<GenerateInput>;
  readonly generate_audio: McpToolDefinition<GenerateInput>;
  readonly get_job: McpToolDefinition<GetJobInput>;
}

export function createVaroriyaTools(deps: VaroriyaToolDependencies): VaroriyaTools {
  return {
    list_models: {
      name: "list_models",
      description: "List public Varoriya generation models and live limits. Use this before requesting a quote.",
      inputSchema: listModelsInputSchema,
      annotations: { readOnlyHint: true },
      execute: async (input, context) => run(context, async () => {
        assertListModelsInput(input);
        // Public discovery never forwards an incidental bearer token upstream.
        const publicContext: RequestContext = {
          requestId: context.requestId,
          scopes: PUBLIC_SCOPES,
        };
        const catalog = await deps.client.getPricing(publicContext);
        const models: ModelPricing[] = [];
        for (const item of catalog.models) {
          const capabilities = input.capability
            ? item.capabilities.filter((value) => value === input.capability)
            : item.capabilities;
          if (capabilities.length === 0) continue;
          const allowed = await Promise.all(
            capabilities.map((kind) => deps.isModelAllowed(publicContext, item.id, kind)),
          );
          const permitted = capabilities.filter((_, index) => allowed[index]);
          if (permitted.length > 0) models.push({ ...item, capabilities: permitted });
        }
        return catalog.updated_at === undefined
          ? { models }
          : { models, updated_at: catalog.updated_at };
      }),
    },
    quote_generation: {
      name: "quote_generation",
      description: "Return a live price and expiring quote token for one authenticated generation request.",
      inputSchema: quoteGenerationInputSchema,
      annotations: { readOnlyHint: true },
      execute: async (input, context) => run(context, async () => {
        assertQuoteInput(input);
        const authenticated = requireAuthenticated(context);
        await deps.guards.requireScope(authenticated, "generation:read");
        await requireAllowedModel(deps, authenticated, input.model, input.kind);
        const parameters = await deps.validateGenerationParameters(
          authenticated,
          input.model,
          input.kind,
          input.parameters,
        );
        return deps.client.quoteGeneration(authenticated, { ...input, parameters });
      }),
    },
    get_balance: {
      name: "get_balance",
      description: "Get the authenticated account's current Varoriya credit balance.",
      inputSchema: getBalanceInputSchema,
      annotations: { readOnlyHint: true },
      execute: async (input, context) => run(context, async () => {
        assertEmptyObject(input);
        const authenticated = requireAuthenticated(context);
        await deps.guards.requireScope(authenticated, "billing:read");
        return deps.client.getMe(authenticated);
      }),
    },
    upload_input: {
      name: "upload_input",
      description: "Upload validated reference media owned by the authenticated user for later generation.",
      inputSchema: uploadInputSchema,
      annotations: { destructiveHint: true, openWorldHint: true },
      execute: async (input, context) => run(context, async () => {
        assertUploadInput(input);
        const authenticated = requireAuthenticated(context);
        await deps.guards.requireScope(authenticated, "files:write");
        await deps.validateUpload(authenticated, input);
        return deps.client.uploadFile(authenticated, input);
      }),
    },
    generate_image: generationTool("image", deps),
    generate_video: generationTool("video", deps),
    generate_audio: generationTool("audio", deps),
    get_job: {
      name: "get_job",
      description: "Read a generation job owned by the authenticated user and return safe result metadata.",
      inputSchema: getJobInputSchema,
      annotations: { readOnlyHint: true },
      execute: async (input, context) => run(context, async () => {
        assertGetJobInput(input);
        const authenticated = requireAuthenticated(context);
        await deps.guards.requireScope(authenticated, "generation:read");
        // Provider job ids are treated as secrets; possession never implies ownership.
        await deps.guards.assertJobOwnership(authenticated, input.job_id);
        return deps.client.getJob(authenticated, input.job_id);
      }),
    },
  };
}

function generationTool(
  kind: GenerationKind,
  deps: VaroriyaToolDependencies,
): McpToolDefinition<GenerateInput> {
  return {
    name: `generate_${kind}`,
    description: `Create a charged ${kind} job after an explicit confirmation using an unexpired live quote.`,
    inputSchema: generateInputSchema,
    annotations: { destructiveHint: true, openWorldHint: true },
    execute: async (input, context) => run(context, async () => {
      assertGenerateInput(input);
      const authenticated = requireAuthenticated(context);
      await deps.guards.requireScope(authenticated, "generation:create");
      await requireAllowedModel(deps, authenticated, input.model, kind);

      const parameters = await deps.validateGenerationParameters(
        authenticated,
        input.model,
        kind,
        input.parameters ?? {},
      );
      const quote = await deps.guards.validateQuote(authenticated, input.quote_token, {
        model: input.model,
        kind,
        parameters,
      });
      if (
        quote.subject !== authenticated.subject
        || quote.token !== input.quote_token
        || isExpired(quote.expiresAt)
      ) {
        throw new ToolHandlerError(
          "INVALID_QUOTE",
          "The quote is invalid or has expired. Request a new quote.",
          false,
        );
      }

      if (input.input_file_ids && input.input_file_ids.length > 0) {
        await deps.guards.assertFileOwnership(authenticated, input.input_file_ids);
      }
      const lease = await deps.guards.acquireIdempotency(
        authenticated,
        input.idempotency_key,
      );
      if (lease.replay) return lease.replay;

      let job: GenerationJob;
      try {
        job = await deps.client.generate(authenticated, kind, {
          model: input.model,
          prompt: input.prompt,
          quote_token: input.quote_token,
          idempotency_key: input.idempotency_key,
          ...(input.input_file_ids === undefined
            ? {}
            : { input_file_ids: input.input_file_ids }),
          parameters,
        });
      } catch (error) {
        // Adapter errors may represent an ambiguous provider submission, so the
        // reservation remains for reconciliation instead of risking a retry.
        if (!(error instanceof VaroriyaApiError)) {
          await lease.abandonBeforeSubmission?.();
        }
        throw error;
      }

      // Never release after submission. A ledger failure needs reconciliation.
      await lease.complete(job);
      return job;
    }),
  };
}

async function requireAllowedModel(
  deps: VaroriyaToolDependencies,
  context: RequestContext,
  model: string,
  kind: GenerationKind,
): Promise<void> {
  if (!(await deps.isModelAllowed(context, model, kind))) {
    throw new ToolHandlerError(
      "UNSUPPORTED_MODEL",
      "The selected model is not supported for this request.",
      false,
    );
  }
}

function requireAuthenticated(context: RequestContext): AuthenticatedRequestContext {
  if (!context.subject || !context.accessToken) {
    throw new ToolHandlerError(
      "AUTH_REQUIRED",
      "Authentication is required to use this tool.",
      false,
    );
  }
  return context as AuthenticatedRequestContext;
}

async function run<T>(
  context: RequestContext,
  operation: () => Promise<T>,
): Promise<ToolResult<T>> {
  try {
    return { ok: true, request_id: context.requestId, data: await operation() };
  } catch (error) {
    return failure(context.requestId, error);
  }
}

function failure(requestId: string, error: unknown): ToolFailure {
  if (error instanceof VaroriyaApiError) {
    return {
      ok: false,
      request_id: error.requestId,
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
      },
    };
  }
  if (error instanceof ToolHandlerError) {
    return {
      ok: false,
      request_id: requestId,
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
      },
    };
  }
  const boundary = toToolBoundaryError(requestId, error);
  return {
    ok: false,
    request_id: boundary.requestId,
    error: {
      code: boundary.code,
      message: boundary.message,
      recoverable: boundary.recoverable,
    },
  };
}

class ToolHandlerError extends Error {
  public constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly recoverable: boolean,
  ) {
    super(message);
    this.name = "ToolHandlerError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function assertListModelsInput(input: unknown): asserts input is ListModelsInput {
  assertObject(input, ["capability"]);
  if ("capability" in input && !isGenerationKind(input.capability)) invalidInput();
}

function assertQuoteInput(input: unknown): asserts input is QuoteGenerationInput {
  assertObject(input, ["model", "kind", "parameters"], ["model", "kind", "parameters"]);
  if (!isModel(input.model) || !isGenerationKind(input.kind) || !isPlainObject(input.parameters)) {
    invalidInput();
  }
}

function assertUploadInput(input: unknown): asserts input is UploadInput {
  assertObject(
    input,
    ["filename", "mime_type", "content_base64"],
    ["filename", "mime_type", "content_base64"],
  );
  if (
    !isNonEmptyString(input.filename, 255)
    || /[\\/]/.test(input.filename)
    || !isMime(input.mime_type)
    || !isBase64(input.content_base64, 10 * 1024 * 1024)
  ) {
    invalidInput();
  }
}

function assertGenerateInput(input: unknown): asserts input is GenerateInput {
  assertObject(
    input,
    ["model", "prompt", "quote_token", "confirm", "idempotency_key", "input_file_ids", "parameters"],
    ["model", "prompt", "quote_token", "confirm", "idempotency_key"],
  );
  if (
    !isModel(input.model)
    || !isNonEmptyString(input.prompt, 8_000)
    || !isNonEmptyString(input.quote_token, 4_096)
    || input.quote_token.length < 16
    || input.confirm !== true
    || !isIdempotencyKey(input.idempotency_key)
  ) {
    invalidInput();
  }
  if (
    input.input_file_ids !== undefined
    && (
      !Array.isArray(input.input_file_ids)
      || input.input_file_ids.length === 0
      || input.input_file_ids.length > 16
      || new Set(input.input_file_ids).size !== input.input_file_ids.length
      || !input.input_file_ids.every((id) => isOpaqueId(id))
    )
  ) {
    invalidInput();
  }
  if (input.parameters !== undefined && !isPlainObject(input.parameters)) invalidInput();
}

function assertGetJobInput(input: unknown): asserts input is GetJobInput {
  assertObject(input, ["job_id"], ["job_id"]);
  if (!isOpaqueId(input.job_id)) invalidInput();
}

function assertEmptyObject(input: unknown): asserts input is Record<string, never> {
  assertObject(input, []);
}

function assertObject(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = [],
): asserts value is Record<string, unknown> {
  if (
    !isPlainObject(value)
    || Object.keys(value).some((key) => !allowed.includes(key))
    || required.some((key) => !(key in value))
  ) {
    invalidInput();
  }
}

function invalidInput(): never {
  throw new ToolHandlerError(
    "INVALID_INPUT",
    "The request is invalid. Check the supplied values and try again.",
    false,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isGenerationKind(value: unknown): value is GenerationKind {
  return value === "image" || value === "video" || value === "audio";
}

function isModel(value: unknown): value is string {
  return isNonEmptyString(value, 128) && /^[A-Za-z0-9._-]+$/.test(value);
}

function isOpaqueId(value: unknown): value is string {
  return isNonEmptyString(value, 256) && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isIdempotencyKey(value: unknown): value is string {
  return isNonEmptyString(value, 128)
    && value.length >= 16
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isMime(value: unknown): value is string {
  return isNonEmptyString(value, 127)
    && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(value);
}

function isBase64(value: unknown, maxBytes: number): value is string {
  if (!isNonEmptyString(value, Math.ceil(maxBytes * 4 / 3) + 4)) return false;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding <= maxBytes;
}

function isExpired(isoTimestamp: string): boolean {
  const parsed = Date.parse(isoTimestamp);
  return Number.isNaN(parsed) || parsed <= Date.now();
}
