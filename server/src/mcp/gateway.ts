import { randomUUID } from "node:crypto";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import type { Authenticator } from "../auth/types.js";
import type { AppConfig } from "../config.js";
import { AppError, asAppError } from "../errors.js";
import type { HealthRegistry } from "../health/readiness.js";
import type { StructuredLogger } from "../observability/logger.js";
import type { OperationsMetrics } from "../observability/metrics.js";
import {
  createRequestCorrelation,
  type RequestCorrelation,
} from "../observability/request-correlation.js";
import type { RuntimeConfig } from "../runtime.js";
import { createVaroriyaTools } from "../tools/handlers.js";
import type {
  GenerationJob,
  GenerationQuote,
  McpToolDefinition,
  RequestContext,
  ToolResult,
  UploadedFile,
} from "../types/varoriya.js";
import type { VaroriyaApiClient } from "../varoriya-api/client.js";

export interface GatewaySecurity {
  readonly guards: Parameters<typeof createVaroriyaTools>[0]["guards"];
  readonly isModelAllowed: Parameters<
    typeof createVaroriyaTools
  >[0]["isModelAllowed"];
  readonly validateGenerationParameters: Parameters<
    typeof createVaroriyaTools
  >[0]["validateGenerationParameters"];
  readonly validateUpload: Parameters<
    typeof createVaroriyaTools
  >[0]["validateUpload"];
  recordQuote(
    context: RequestContext,
    quote: GenerationQuote,
    parameters: Readonly<Record<string, unknown>>,
  ): void | Promise<void>;
  recordUploadedFile(
    context: RequestContext,
    file: UploadedFile,
  ): void | Promise<void>;
  recordJob(context: RequestContext, job: GenerationJob): void | Promise<void>;
}

export interface GatewayDependencies {
  readonly appConfig: AppConfig;
  readonly runtime: RuntimeConfig;
  readonly authenticator: Authenticator;
  readonly client: VaroriyaApiClient;
  readonly security: GatewaySecurity;
  readonly operations?: GatewayOperations;
}

export interface GatewayOperations {
  readonly logger: StructuredLogger;
  readonly metrics: OperationsMetrics;
  readonly health: HealthRegistry;
}

export function createGatewayApp(dependencies: GatewayDependencies): Express {
  const allowedHosts = dependencies.runtime.publicOrigin
    ? publicAllowedHosts(
        dependencies.runtime.publicOrigin,
        dependencies.runtime.host,
      )
    : localAllowedHosts(dependencies.runtime.host);
  const app = express();
  if (allowedHosts) app.use(hostHeaderValidation(allowedHosts));
  const correlations = new WeakMap<Request, RequestCorrelation>();
  if (dependencies.operations) {
    app.use((request, response, next) => {
      const startedAt = Date.now();
      const correlation = createRequestCorrelation(request.headers["x-request-id"]);
      correlations.set(request, correlation);
      response.setHeader("x-request-id", correlation.requestId);
      response.once("finish", () => {
        const route = request.path === "/mcp" ? "mcp" : "health";
        const durationMs = Math.max(0, Date.now() - startedAt);
        dependencies.operations?.metrics.request({
          route,
          status: response.statusCode,
          durationMs,
        });
        dependencies.operations?.logger
          .withCorrelation(correlation)
          .log("info", "http.request.completed", {
            method: request.method,
            route,
            status: response.statusCode,
            duration_ms: durationMs,
          });
      });
      next();
    });
  }
  app.use(
    express.json({
      limit: maximumMcpJsonBytes(dependencies.appConfig.media.maxUploadBytes),
      strict: true,
      type: "application/json",
    }),
  );
  const tools = Object.values(
    createVaroriyaTools({
      client: dependencies.client,
      guards: dependencies.security.guards,
      isModelAllowed: dependencies.security.isModelAllowed,
      validateGenerationParameters:
        dependencies.security.validateGenerationParameters,
      validateUpload: dependencies.security.validateUpload,
    }),
  ) as readonly McpToolDefinition<unknown>[];
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

  app.get("/healthz", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get("/livez", (_request, response) => {
    response
      .status(200)
      .json(dependencies.operations?.health.liveness() ?? { status: "alive" });
  });
  app.get("/readyz", async (_request, response) => {
    if (!dependencies.operations) {
      response.status(200).json({ status: "ready", dependencies: [] });
      return;
    }
    const readiness = await dependencies.operations.health.readiness();
    for (const dependency of readiness.dependencies) {
      dependencies.operations.metrics.readiness({
        dependency: dependency.name,
        ready: dependency.state === "pass",
      });
    }
    response.status(readiness.status === "ready" ? 200 : 503).json(readiness);
  });

  if (dependencies.appConfig.oauth && dependencies.runtime.publicOrigin) {
    const resource = `${dependencies.runtime.publicOrigin}/mcp`;
    const metadata = Object.freeze({
      resource,
      authorization_servers: [dependencies.appConfig.oauth.issuer],
      scopes_supported: [
        "generation:read",
        "generation:create",
        "billing:read",
        "files:write",
      ],
      bearer_methods_supported: ["header"],
    });
    app.get("/.well-known/oauth-protected-resource", (_request, response) => {
      response.status(200).json(metadata);
    });
    app.get(
      "/.well-known/oauth-protected-resource/mcp",
      (_request, response) => {
        response.status(200).json(metadata);
      },
    );
  }

  app.post("/mcp", async (request, response) => {
    if (isProtectedToolCall(request.body)) {
      const authenticated = await authenticateHttpBoundary(
        request,
        response,
        dependencies,
        correlations.get(request),
      );
      if (!authenticated) return;
    }
    const server = createRequestServer(
      request,
      dependencies,
      tools,
      toolByName,
      correlations.get(request),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_request: Request, response: Response) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (response.headersSent) {
        next(error);
        return;
      }
      const status = bodyParserStatus(error);
      if (status !== 400 && status !== 413) {
        next(error);
        return;
      }
      const tooLarge = status === 413;
      response.setHeader("Cache-Control", "no-store");
      response.status(status).json({
        jsonrpc: "2.0",
        error: {
          code: -32002,
          message: tooLarge ? "Request payload too large" : "Invalid JSON request",
          data: {
            code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT",
            message: tooLarge
              ? "The request body exceeds the configured upload limit."
              : "The request body must contain valid JSON.",
            recoverable: false,
          },
        },
        id: null,
      });
    },
  );

  return app;
}

async function authenticateHttpBoundary(
  request: Request,
  response: Response,
  dependencies: GatewayDependencies,
  correlation?: RequestCorrelation,
): Promise<boolean> {
  const requestId = correlation?.requestId ?? randomUUID();
  try {
    if (!hasCredential(request, dependencies.appConfig)) {
      throw new AppError("AUTH_REQUIRED", {
        status: 401,
        message: "Authentication is required.",
      });
    }
    await dependencies.authenticator.authenticate(request.headers);
    dependencies.operations?.metrics.auth({
      mode: dependencies.appConfig.authMode,
      outcome: "success",
    });
    return true;
  } catch (error) {
    const failure = asAppError(error);
    dependencies.operations?.metrics.auth({
      mode: dependencies.appConfig.authMode,
      outcome: failure.code === "AUTH_REQUIRED" ? "required" : "invalid",
    });
    if (
      dependencies.appConfig.authMode === "oauth" &&
      dependencies.runtime.publicOrigin
    ) {
      response.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${dependencies.runtime.publicOrigin}/.well-known/oauth-protected-resource/mcp"`,
      );
    }
    response.setHeader("Cache-Control", "no-store");
    response.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Authentication required",
        data: failure.toPublicBody(requestId),
      },
      id: requestBodyId(request.body),
    });
    return false;
  }
}

function isProtectedToolCall(body: unknown): boolean {
  if (!isRecord(body) || body.method !== "tools/call" || !isRecord(body.params)) {
    return false;
  }
  return body.params.name !== "list_models";
}

function requestBodyId(body: unknown): string | number | null {
  if (!isRecord(body)) return null;
  const id = body.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRequestServer(
  request: Request,
  dependencies: GatewayDependencies,
  tools: readonly McpToolDefinition<unknown>[],
  toolByName: ReadonlyMap<string, McpToolDefinition<unknown>>,
  correlation?: RequestCorrelation,
): Server {
  const server = new Server(
    { name: "varoriya-mcp-gateway", version: "0.2.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Discover an allowed model, obtain a live quote, ask for explicit user confirmation, then call exactly one generation tool. Poll get_job until completion and warn that result URLs expire.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    const tool = toolByName.get(call.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, "Unknown tool.");
    }
    const requestId = correlation?.requestId ?? randomUUID();
    let context: RequestContext;
    try {
      context =
        tool.name === "list_models"
          ? Object.freeze({ requestId, scopes: new Set<string>() })
          : await createRequestContext(request, requestId, dependencies);
    } catch (error) {
      dependencies.operations?.metrics.tool({
        tool: tool.name,
        outcome: "failure",
      });
      return mcpResult({
        ok: false,
        request_id: requestId,
        error: asAppError(error).toPublicBody(requestId),
      });
    }

    let result: ToolResult<unknown>;
    try {
      result = await tool.execute(call.params.arguments ?? {}, context);
    } catch (error) {
      dependencies.operations?.metrics.tool({
        tool: tool.name,
        outcome: "failure",
      });
      return mcpResult({
        ok: false,
        request_id: requestId,
        error: asAppError(error).toPublicBody(requestId),
      });
    }
    if (result.ok) {
      try {
        await recordOwnedResult(
          tool.name,
          context,
          call.params.arguments ?? {},
          result,
          dependencies.security,
        );
      } catch (error) {
        dependencies.operations?.metrics.tool({
          tool: tool.name,
          outcome: "failure",
        });
        return mcpResult({
          ok: false,
          request_id: requestId,
          error: asAppError(error).toPublicBody(requestId),
        });
      }
    }
    dependencies.operations?.metrics.tool({
      tool: tool.name,
      outcome: result.ok ? "success" : "failure",
    });
    return mcpResult(result);
  });

  return server;
}

async function createRequestContext(
  request: Request,
  requestId: string,
  dependencies: GatewayDependencies,
): Promise<RequestContext> {
  if (!hasCredential(request, dependencies.appConfig)) {
    return Object.freeze({ requestId, scopes: new Set<string>() });
  }
  const auth = await dependencies.authenticator.authenticate(request.headers);
  const accessToken =
    auth.mode === "oauth"
      ? bearerValue(request)
      : dependencies.runtime.providerApiKey;
  return Object.freeze({
    requestId,
    subject: auth.userId,
    ...(accessToken ? { accessToken } : {}),
    scopes: auth.scopes,
  });
}

function hasCredential(request: Request, config: AppConfig): boolean {
  const name =
    config.authMode === "oauth"
      ? "authorization"
      : config.devApiKey?.headerName ?? "x-varoriya-dev-api-key";
  return request.headers[name] !== undefined;
}

function bearerValue(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header || Array.isArray(header)) return undefined;
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(header);
  return match?.[1];
}

async function recordOwnedResult(
  toolName: string,
  context: RequestContext,
  input: unknown,
  result: Extract<ToolResult<unknown>, { ok: true }>,
  security: GatewaySecurity,
): Promise<void> {
  if (toolName === "quote_generation") {
    await security.recordQuote(
      context,
      result.data as GenerationQuote,
      quoteParameters(input),
    );
  } else if (toolName === "upload_input") {
    await security.recordUploadedFile(context, result.data as UploadedFile);
  } else if (toolName.startsWith("generate_")) {
    await security.recordJob(context, result.data as GenerationJob);
  }
}

function quoteParameters(input: unknown): Readonly<Record<string, unknown>> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    typeof (input as Record<string, unknown>).parameters !== "object" ||
    (input as Record<string, unknown>).parameters === null ||
    Array.isArray((input as Record<string, unknown>).parameters)
  ) {
    throw new Error("Validated quote parameters are missing.");
  }
  return (input as { parameters: Readonly<Record<string, unknown>> }).parameters;
}

function mcpResult(result: object): {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
  isError: boolean;
} {
  const structuredContent = result as Record<string, unknown>;
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent,
    isError: structuredContent.ok === false,
  };
}

function publicAllowedHosts(origin: string, bindHost: string): string[] {
  const parsed = new URL(origin);
  const loopback =
    bindHost === "127.0.0.1" || bindHost === "::1" || bindHost === "localhost"
      ? [bindHost]
      : [];
  return Array.from(new Set([parsed.hostname, ...loopback]));
}

function localAllowedHosts(bindHost: string): string[] | undefined {
  if (bindHost === "127.0.0.1") return ["127.0.0.1", "localhost", "[::1]"];
  if (bindHost === "localhost") return ["localhost", "127.0.0.1", "[::1]"];
  if (bindHost === "::1") return ["[::1]", "localhost", "127.0.0.1"];
  return undefined;
}

function maximumMcpJsonBytes(maxUploadBytes: number): number {
  // Base64 expands by 4/3. Reserve bounded space for the JSON-RPC envelope,
  // prompt, file metadata, and escaping without accepting an unbounded body.
  const encodedMediaBytes = Math.ceil(maxUploadBytes / 3) * 4;
  return encodedMediaBytes + 256 * 1024;
}

function bodyParserStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { readonly status?: unknown }).status;
  return status === 400 || status === 413 ? status : undefined;
}
