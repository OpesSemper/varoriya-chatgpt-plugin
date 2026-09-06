import { createServer, type Server as HttpServer } from "node:http";

import { createAuthenticator } from "./auth/index.js";
import { loadConfig } from "./config.js";
import { AppError, asAppError } from "./errors.js";
import { createDevelopmentSecurity } from "./infrastructure/development-security.js";
import { JoseJwtVerifier } from "./infrastructure/jose-jwt-verifier.js";
import { createGatewayApp } from "./mcp/gateway.js";
import { loadRuntimeConfig } from "./runtime.js";
import { VaroriyaApiClient } from "./varoriya-api/client.js";

export async function start(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<HttpServer> {
  const appConfig = loadConfig(env);
  const runtime = loadRuntimeConfig(env);

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
  const security = createDevelopmentSecurity(appConfig, runtime);
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
  });
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(runtime.port, runtime.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  process.stdout.write(
    JSON.stringify({
      event: "gateway_started",
      host: runtime.host,
      port: runtime.port,
      auth_mode: appConfig.authMode,
    }) + "\n",
  );
  return server;
}

function failConfiguration(message: string): never {
  throw new AppError("CONFIG_INVALID", { status: 500, message });
}

async function main(): Promise<void> {
  const server = await start();
  const shutdown = () => {
    server.close((error) => {
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
