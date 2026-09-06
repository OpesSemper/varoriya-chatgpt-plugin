import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { createDevelopmentSecurity } from '../src/infrastructure/development-security.ts';
import { createGatewayApp } from '../src/mcp/gateway.ts';
import { loadConfig } from '../src/config.ts';
import { loadRuntimeConfig } from '../src/runtime.ts';

const MCP_PROTOCOL_VERSION = '2025-06-18';

function createFakeDependencies() {
  const calls = [];
  const scopes = new Set([
    'generation:read',
    'generation:create',
    'billing:read',
    'files:write',
  ]);

  const client = {
    async getPricing(context) {
      calls.push(['getPricing', context.subject]);
      return {
        models: [
          {
            id: 'varoriya-image-fixture',
            display_name: 'Fixture Image',
            capabilities: ['image'],
            limits: { max_prompt_length: 8000 },
          },
        ],
        updated_at: '2026-09-06T00:00:00.000Z',
      };
    },
    async quoteGeneration() {
      calls.push(['quoteGeneration']);
      return {
        quote_token: 'quote-token-fixture-image-001',
        model: 'varoriya-image-fixture',
        kind: 'image',
        estimated_cost: { amount: '12', currency: 'CRD' },
        expires_at: '2099-01-01T00:00:00.000Z',
      };
    },
    async getMe(context) {
      calls.push(['getMe', context.subject]);
      return { balance: { amount: '100', currency: 'CRD' } };
    },
    async uploadFile() {
      calls.push(['uploadFile']);
      return { file_id: 'file-fixture-001', status: 'ready' };
    },
    async generate() {
      calls.push(['generate']);
      return {
        job_id: 'job-fixture-001',
        status: 'queued',
        model: 'varoriya-image-fixture',
        next_action: 'Call get_job with this job_id to check progress.',
      };
    },
    async getJob() {
      calls.push(['getJob']);
      return {
        job_id: 'job-fixture-001',
        status: 'completed',
        model: 'varoriya-image-fixture',
        result_urls: ['https://cdn.example.test/result.png'],
        next_action: 'Result is ready.',
      };
    },
  };

  const security = {
    guards: {
      async requireScope(context, scope) {
        assert.equal(context.subject, 'user-fixture');
        assert.ok(context.scopes.has(scope));
      },
      async validateQuote(context, token, expected) {
        assert.equal(context.subject, 'user-fixture');
        return {
          subject: context.subject,
          token,
          model: expected.model,
          kind: expected.kind,
          parameters: expected.parameters,
          expiresAt: '2099-01-01T00:00:00.000Z',
        };
      },
      async acquireIdempotency() {
        return { async complete() {} };
      },
      async assertJobOwnership(context, jobId) {
        assert.equal(context.subject, 'user-fixture');
        assert.equal(jobId, 'job-fixture-001');
      },
      async assertFileOwnership(context, fileIds) {
        assert.equal(context.subject, 'user-fixture');
        assert.deepEqual(fileIds, ['file-fixture-001']);
      },
    },
    async isModelAllowed() {
      return true;
    },
    validateGenerationParameters(_context, _model, _kind, parameters) {
      return parameters;
    },
    async validateUpload() {},
    async recordQuote() {},
    async recordUploadedFile() {},
    async recordJob() {},
  };

  const appConfig = {
    authMode: 'dev-api-key',
    devApiKey: { headerName: 'x-varoriya-dev-api-key' },
  };
  const runtime = {
    host: '127.0.0.1',
    port: 0,
    apiBaseUrl: 'https://provider.invalid',
    apiTimeoutMs: 1000,
    providerApiKey: 'fixture-provider-credential',
    modelPolicies: [],
  };
  const authenticator = {
    async authenticate(headers) {
      assert.equal(headers['x-varoriya-dev-api-key'], 'fixture-dev-key');
      return {
        mode: 'dev-api-key',
        userId: 'user-fixture',
        subject: 'user-fixture',
        scopes,
      };
    },
  };

  return { app: createGatewayApp({ appConfig, runtime, authenticator, client, security }), calls };
}

async function startEphemeralApp() {
  const { app, calls } = createFakeDependencies();
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: 'application/json, text/event-stream',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : undefined,
  };
}

function mcpRequest(id, method, params = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

function initializeRequest() {
  return mcpRequest(1, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'varoriya-gateway-test', version: '1.0.0' },
  });
}

async function postMcp(baseUrl, message, headers = {}) {
  return requestJson(baseUrl, '/mcp', {
    method: 'POST',
    headers: {
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
      ...headers,
    },
    body: JSON.stringify(message),
  });
}

test('SEV-1 gateway exposes health, rejects GET /mcp, and completes MCP initialization', async (t) => {
  const gateway = await startEphemeralApp();
  t.after(() => gateway.close());

  const health = await requestJson(gateway.baseUrl, '/healthz');
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, { status: 'ok' });

  const getMcp = await requestJson(gateway.baseUrl, '/mcp', { method: 'GET' });
  assert.equal(getMcp.response.status, 405);
  assert.equal(getMcp.body.error.code, -32000);

  const initialized = await postMcp(gateway.baseUrl, initializeRequest());
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.body.jsonrpc, '2.0');
  assert.equal(initialized.body.id, 1);
  assert.equal(initialized.body.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(initialized.body.result.capabilities, { tools: {} });
  assert.equal(initialized.body.result.serverInfo.name, 'varoriya-mcp-gateway');
});

test('SEV-1 stateless transport supports tool listing and a no-network tool call after initialization', async (t) => {
  const gateway = await startEphemeralApp();
  t.after(() => gateway.close());

  const initialized = await postMcp(gateway.baseUrl, initializeRequest());
  assert.equal(initialized.response.status, 200);

  const listed = await postMcp(
    gateway.baseUrl,
    mcpRequest(2, 'tools/list'),
  );
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.id, 2);
  const toolNames = listed.body.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, [
    'generate_audio',
    'generate_image',
    'generate_video',
    'get_balance',
    'get_job',
    'list_models',
    'quote_generation',
    'upload_input',
  ]);
  assert.equal(listed.body.result.tools.find((tool) => tool.name === 'generate_image').annotations.destructiveHint, true);

  const called = await postMcp(
    gateway.baseUrl,
    mcpRequest(3, 'tools/call', {
      name: 'list_models',
      arguments: {},
    }),
  );
  assert.equal(called.response.status, 200);
  assert.equal(called.body.id, 3);
  assert.equal(called.body.result.isError, false);
  assert.deepEqual(called.body.result.structuredContent.data.models, [
    {
      id: 'varoriya-image-fixture',
      display_name: 'Fixture Image',
      capabilities: ['image'],
      limits: { max_prompt_length: 8000 },
    },
  ]);
  assert.deepEqual(gateway.calls, [['getPricing', undefined]]);
});

test('SEV-1 stateless transport authenticates a private tool call without contacting a real provider', async (t) => {
  const gateway = await startEphemeralApp();
  t.after(() => gateway.close());

  const initialized = await postMcp(gateway.baseUrl, initializeRequest());
  assert.equal(initialized.response.status, 200);

  const called = await postMcp(
    gateway.baseUrl,
    mcpRequest(4, 'tools/call', {
      name: 'get_balance',
      arguments: {},
    }),
    { 'x-varoriya-dev-api-key': 'fixture-dev-key' },
  );
  assert.equal(called.response.status, 200);
  assert.equal(called.body.result.isError, false);
  assert.deepEqual(called.body.result.structuredContent.data, {
    balance: { amount: '100', currency: 'CRD' },
  });
  assert.deepEqual(gateway.calls, [['getMe', 'user-fixture']]);
});

test('SEV-1 protected tool calls fail at the HTTP boundary when authentication is missing', async (t) => {
  const gateway = await startEphemeralApp();
  t.after(() => gateway.close());

  const called = await postMcp(
    gateway.baseUrl,
    mcpRequest(5, 'tools/call', {
      name: 'get_balance',
      arguments: {},
    }),
  );
  assert.equal(called.response.status, 401);
  assert.equal(called.response.headers.get('cache-control'), 'no-store');
  assert.equal(called.body.error.data.code, 'AUTH_REQUIRED');
  assert.deepEqual(gateway.calls, []);
});

test('SEV-1 runtime rejects development API-key mode in production and production security adapters fail closed', () => {
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'production',
      VARORIYA_AUTH_MODE: 'dev-api-key',
      VARORIYA_DEV_API_KEY: 'a'.repeat(32),
      VARORIYA_DEV_PRINCIPAL_ID: 'fixture-user',
      VARORIYA_DEV_SCOPES: 'generation:read',
      PUBLIC_ORIGIN: 'https://plugin.example.test',
    }),
    /security configuration is invalid/i,
  );

  const productionEnv = {
    NODE_ENV: 'production',
    VARORIYA_AUTH_MODE: 'oauth',
    VARORIYA_OAUTH_ISSUER: 'https://issuer.example.test',
    VARORIYA_OAUTH_AUDIENCES: 'varoriya-gateway',
    VARORIYA_OAUTH_JWKS_URI: 'https://issuer.example.test/.well-known/jwks.json',
    PUBLIC_ORIGIN: 'https://plugin.example.test',
  };
  const appConfig = loadConfig(productionEnv);
  const runtime = loadRuntimeConfig(productionEnv);
  assert.throws(
    () => createDevelopmentSecurity(appConfig, runtime),
    /Production security adapters are not configured/i,
  );
});
