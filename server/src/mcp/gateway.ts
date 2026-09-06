import { randomUUID } from "node:crypto";

import type { Express, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
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
}

export function createGatewayApp(dependencies: GatewayDependencies): Express {
  const allowedHosts = dependencies.runtime.publicOrigin
    ? publicAllowedHosts(dependencies.runtime.publicOrigin)
    : undefined;
  const app = createMcpExpressApp({
    host: dependencies.runtime.host,
    ...(allowedHosts ? { allowedHosts } : {}),
  });
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
      );
      if (!authenticated) return;
    }
    const server = createRequestServer(
      request,
      dependencies,
      tools,
      toolByName,
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

  return app;
}

async function authenticateHttpBoundary(
  request: Request,
  response: Response,
  dependencies: GatewayDependencies,
): Promise<boolean> {
  const requestId = randomUUID();
  try {
    if (!hasCredential(request, dependencies.appConfig)) {
      throw new AppError("AUTH_REQUIRED", {
        status: 401,
        message: "Authentication is required.",
      });
    }
    await dependencies.authenticator.authenticate(request.headers);
    return true;
  } catch (error) {
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
        data: asAppError(error).toPublicBody(requestId),
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
): Server {
  const server = new Server(
    { name: "varoriya-mcp-gateway", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Discover an allowed model, obtain a live quote, ask for explicit user confirmation, then call exactly one generation tool. Poll get_job until completion and warn that result URLs expire.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    const tool = toolByName.get(call.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, "Unknown tool.");
    }
    const requestId = randomUUID();
    let context: RequestContext;
    try {
      context = await createRequestContext(request, requestId, dependencies);
    } catch (error) {
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
        return mcpResult({
          ok: false,
          request_id: requestId,
          error: asAppError(error).toPublicBody(requestId),
        });
      }
    }
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

function publicAllowedHosts(origin: string): string[] {
  const parsed = new URL(origin);
  return Array.from(new Set([parsed.hostname, parsed.host]));
}
