import { createServer, type Server as HttpServer } from "node:http";

import { createAuthenticator } from "./auth/index.js";
import { loadConfig } from "./config.js";
import { AppError, asAppError } from "./errors.js";
import { createHealthRegistry } from "./health/readiness.js";
import { ClamAvScanner } from "./infrastructure/clamav-scanner.js";
import { createDevelopmentSecurity } from "./infrastructure/development-security.js";
import { JoseJwtVerifier } from "./infrastructure/jose-jwt-verifier.js";
import { NodePostgresDatabase } from "./infrastructure/postgres/node-postgres.js";
import { createProductionSecurity } from "./infrastructure/production-security.js";
import { createGatewayApp } from "./mcp/gateway.js";
import { createJsonLogger } from "./observability/logger.js";
import { createLogMetricsSink } from "./observability/log-metrics.js";
import { createOperationsMetrics } from "./observability/metrics.js";
import { loadRuntimeConfig } from "./runtime.js";
import { VaroriyaApiClient } from "./varoriya-api/client.js";

export async function start(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<HttpServer> {
  return (await startGateway(env)).server;
}

interface StartedGateway {
  readonly server: HttpServer;
  readonly shutdownTimeoutMs: number;
}

async function startGateway(
  env: Readonly<Record<string, string | undefined>>,
): Promise<StartedGateway> {
  const appConfig = loadConfig(env);
  const runtime = loadRuntimeConfig(env);
  const logger = createJsonLogger({
    service: "varoriya-mcp-gateway",
    environment: appConfig.environment,
  });
  const metrics = createOperationsMetrics(createLogMetricsSink(logger));

  if (appConfig.authMode === "dev-api-key" && !runtime.providerApiKey) {
    throw new AppError("CONFIG_INVALID", {
      status: 500,
      message: "VARORIYA_API_KEY is required in development API-key mode.",
    });
  }

  const jwtVerifier =
    appConfig.authMode === "oauth"
      ? new JoseJwtVerifier(
          runtime.oauthJwksUri ??
            failConfiguration("VARORIYA_OAUTH_JWKS_URI is required for OAuth."),
        )
      : undefined;
  const authenticator = createAuthenticator(appConfig, jwtVerifier);
  const database =
    appConfig.environment === "production"
      ? new NodePostgresDatabase({
          connectionString:
            runtime.databaseUrl ??
            failConfiguration("DATABASE_URL is required in production."),
          maxConnections: runtime.databasePoolMax,
          connectionTimeoutMs: runtime.databaseConnectionTimeoutMs,
          statementTimeoutMs: runtime.databaseStatementTimeoutMs,
        })
      : undefined;
  const malwareScanner =
    appConfig.environment === "production"
      ? new ClamAvScanner({
          host:
            runtime.clamAvHost ??
            failConfiguration("CLAMAV_HOST is required in production."),
          port: runtime.clamAvPort,
          timeoutMs: runtime.clamAvTimeoutMs,
        })
      : undefined;
  const security =
    appConfig.environment === "production"
      ? createProductionSecurity(appConfig, runtime, {
          database:
            database ?? failConfiguration("Production database is unavailable."),
          malwareScanner:
            malwareScanner ??
            failConfiguration("Production malware scanner is unavailable."),
        })
      : createDevelopmentSecurity(appConfig, runtime);
  const health = createHealthRegistry({
    timeoutMs: runtime.healthTimeoutMs,
    dependencies:
      database && malwareScanner
        ? [
            {
              name: "durable-store",
              required: true,
              check: async () => {
                await database.query(
                  "SELECT 1 FROM varoriya_security.resource_owners LIMIT 1",
                );
              },
            },
            {
              name: "malware-scanner",
              required: true,
              check: () => malwareScanner.check(),
            },
          ]
        : [],
  });
  const client = new VaroriyaApiClient({
    baseUrl: runtime.apiBaseUrl,
    timeoutMs: runtime.apiTimeoutMs,
  });
  const app = createGatewayApp({
    appConfig,
    runtime,
    authenticator,
    client,
    security,
    operations: { logger, metrics, health },
  });
  const server = createServer(app);
  server.once("close", () => {
    void database?.close();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(runtime.port, runtime.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  logger.log("info", "gateway.started", {
    host: runtime.host,
    port: runtime.port,
    auth_mode: appConfig.authMode,
  });
  return Object.freeze({
    server,
    shutdownTimeoutMs: runtime.shutdownTimeoutMs,
  });
}

function failConfiguration(message: string): never {
  throw new AppError("CONFIG_INVALID", { status: 500, message });
}

async function main(): Promise<void> {
  const { server, shutdownTimeoutMs } = await startGateway(process.env);
  const shutdown = () => {
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      process.exitCode = 1;
    }, shutdownTimeoutMs);
    timeout.unref();
    server.close((error) => {
      clearTimeout(timeout);
      process.exitCode = error ? 1 : 0;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    const failure = asAppError(error);
    process.stderr.write(
      JSON.stringify({
        event: "gateway_start_failed",
        code: failure.code,
        message: failure.message,
      }) + "\n",
    );
    process.exitCode = 1;
  });
}
