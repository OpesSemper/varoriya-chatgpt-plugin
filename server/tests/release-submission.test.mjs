import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { GenerationSecurityGuards } from '../src/policy/generation-guards.ts';
import { IdempotencyPolicy, InMemoryIdempotencyStore } from '../src/policy/idempotency.ts';
import { InMemoryOwnershipStore, OwnershipPolicy } from '../src/policy/ownership.ts';
import { QuoteValidationPolicy } from '../src/policy/quote.ts';
import { redactHeaders, redactLogValue, redactUrl } from '../src/policy/redaction.ts';
import { ScopePolicy } from '../src/policy/scope.ts';
import { createGatewayApp } from '../src/mcp/gateway.ts';
import { createVaroriyaTools } from '../src/tools/handlers.ts';
import { generateInputSchema, getJobInputSchema } from '../src/tools/schemas.ts';
import {
  MCP_PROTOCOL_VERSION,
  RELEASE_EPOCH_SECONDS,
  RELEASE_FILE_ID,
  RELEASE_IDEMPOTENCY_KEY,
  RELEASE_JOB_ID,
  RELEASE_MODEL,
  RELEASE_PROMPT,
  RELEASE_QUOTE_TOKEN,
  aliceContext,
  assertNoProviderNetwork,
  bobContext,
  generationInput,
  generationJob,
  initializeRequest,
  jsonResponse,
  mcpRequest,
  publicContext,
  quoteClaims,
} from '../test-fixtures/release/harness-fixtures.mjs';

function createToolHarness({ quoteOverrides = {}, providerDelayMs = 0 } = {}) {
  const calls = [];
  const ownershipStore = new InMemoryOwnershipStore('test');
  ownershipStore.bindJob(RELEASE_JOB_ID, aliceContext.subject);
  ownershipStore.bindFile(RELEASE_FILE_ID, aliceContext.subject);

  const quoteVerifier = {
    async verify(token) {
      if (token !== RELEASE_QUOTE_TOKEN) throw new Error('unknown fixture quote');
      return quoteClaims(quoteOverrides);
    },
  };
  const guards = new GenerationSecurityGuards({
    scopes: new ScopePolicy(),
    quotes: new QuoteValidationPolicy(quoteVerifier, { now: () => RELEASE_EPOCH_SECONDS }),
    idempotency: new IdempotencyPolicy(new InMemoryIdempotencyStore('test'), {
      reservationTtlMilliseconds: 60_000,
      completedRetentionMilliseconds: 120_000,
    }),
    ownership: new OwnershipPolicy(ownershipStore),
  });

  const client = {
    async getPricing(context) {
      calls.push(['getPricing', context.subject]);
      return {
        models: [{
          id: RELEASE_MODEL,
          display_name: 'Release fixture image model',
          capabilities: ['image'],
          limits: { max_prompt_length: 8_000 },
          pricing: { unit: 'CRD', amount: '0' },
        }],
        updated_at: '2026-09-06T00:00:00.000Z',
      };
    },
    async quoteGeneration(context, input) {
      calls.push(['quoteGeneration', context.subject, input]);
      return {
        quote_token: RELEASE_QUOTE_TOKEN,
        model: RELEASE_MODEL,
        kind: 'image',
        estimated_cost: { amount: '0', currency: 'CRD' },
        expires_at: '2027-01-15T00:00:00.000Z',
      };
    },
    async getMe(context) {
      calls.push(['getMe', context.subject]);
      return { balance: { amount: '0', currency: 'CRD' } };
    },
    async uploadFile(context, input) {
      calls.push(['uploadFile', context.subject, input]);
      return { file_id: RELEASE_FILE_ID, status: 'ready' };
    },
    async generate(context, kind, input) {
      calls.push(['generate', context.subject, kind, input]);
      if (providerDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
      return generationJob;
    },
    async getJob(context, jobId) {
      calls.push(['getJob', context.subject, jobId]);
      return { ...generationJob, status: 'completed', result_urls: ['https://cdn.fixture.invalid/result.png'] };
    },
  };

  const tools = createVaroriyaTools({
    client,
    guards,
    isModelAllowed: async (_context, model, kind) => model === RELEASE_MODEL && kind === 'image',
    validateGenerationParameters: async (_context, model, kind, parameters) => {
      if (model !== RELEASE_MODEL || kind !== 'image') throw new Error('unsupported fixture');
      return parameters;
    },
    validateUpload: async () => undefined,
  });
  return { calls, tools };
}

function createGatewayHarness() {
  const calls = [];
  const client = {
    async getPricing(context) {
      calls.push(['getPricing', context.subject]);
      return { models: [{ id: RELEASE_MODEL, display_name: 'Release fixture', capabilities: ['image'] }] };
    },
    async quoteGeneration() { calls.push(['quoteGeneration']); return { quote_token: RELEASE_QUOTE_TOKEN, model: RELEASE_MODEL, kind: 'image', estimated_cost: { amount: '0', currency: 'CRD' }, expires_at: '2027-01-15T00:00:00.000Z' }; },
    async getMe(context) { calls.push(['getMe', context.subject]); return { balance: { amount: '0', currency: 'CRD' } }; },
    async uploadFile() { calls.push(['uploadFile']); return { file_id: RELEASE_FILE_ID, status: 'ready' }; },
    async generate() { calls.push(['generate']); return generationJob; },
    async getJob() { calls.push(['getJob']); return generationJob; },
  };
  const security = {
    guards: {
      async requireScope() {},
      async validateQuote(_context, token, expected) { return { subject: aliceContext.subject, token, ...expected, expiresAt: '2027-01-15T00:00:00.000Z' }; },
      async acquireIdempotency() { return { async complete() {} }; },
      async assertJobOwnership() {},
      async assertFileOwnership() {},
    },
    async isModelAllowed() { return true; },
    validateGenerationParameters(_context, _model, _kind, parameters) { return parameters; },
    async validateUpload() {},
    async recordQuote() {},
    async recordUploadedFile() {},
    async recordJob() {},
  };
  const appConfig = {
    authMode: 'oauth',
    media: { maxUploadBytes: 1_024, allowedMimeTypes: ['image/png'] },
    oauth: {
      issuer: 'https://issuer.fixture.invalid',
      audiences: ['varoriya-gateway'],
      allowedAlgorithms: ['RS256'],
      resourceOwnerClaim: 'sub',
      clockToleranceSeconds: 30,
    },
  };
  const runtime = {
    host: '127.0.0.1',
    port: 0,
    publicOrigin: 'https://plugin.fixture.invalid',
    apiBaseUrl: 'https://provider.fixture.invalid',
    apiTimeoutMs: 1_000,
    modelPolicies: [],
  };
  const authenticator = {
    async authenticate(headers) {
      assert.equal(headers.authorization, 'Bearer release-fixture-access-alice');
      return { mode: 'oauth', userId: aliceContext.subject, subject: aliceContext.subject, scopes: aliceContext.scopes };
    },
  };
  return { app: createGatewayApp({ appConfig, runtime, authenticator, client, security }), calls };
}

async function startGateway() {
  const gateway = createGatewayHarness();
  const server = createServer(gateway.app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls: gateway.calls,
    async close() { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
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
  return { response, body: text ? JSON.parse(text) : undefined };
}

async function postMcp(baseUrl, body, headers = {}) {
  return requestJson(baseUrl, '/mcp', {
    method: 'POST',
    headers: { 'mcp-protocol-version': MCP_PROTOCOL_VERSION, ...headers },
    body: JSON.stringify(body),
  });
}

test('RELEASE-POS-001 contract, closed schemas, and safety annotations are reviewer-ready', () => {
  const { tools } = createToolHarness();
  assert.deepEqual(Object.keys(tools).sort(), [
    'generate_audio', 'generate_image', 'generate_video', 'get_balance',
    'get_job', 'list_models', 'quote_generation', 'upload_input',
  ]);
  for (const tool of Object.values(tools)) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.outputSchema.type, 'object');
    assert.equal(tool.outputSchema.additionalProperties, false);
    assert.match(tool.title, /\S/);
    assert.match(tool.description, /\S/);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean');
  }
  assert.equal(tools.list_models.annotations.readOnlyHint, true);
  assert.equal(tools.quote_generation.annotations.readOnlyHint, true);
  assert.equal(tools.get_balance.annotations.readOnlyHint, true);
  assert.equal(tools.get_job.annotations.readOnlyHint, true);
  for (const name of ['generate_image', 'generate_video', 'generate_audio']) {
    assert.equal(tools[name].annotations.destructiveHint, true);
    assert.equal(tools[name].annotations.openWorldHint, true);
  }
  assert.equal(tools.upload_input.annotations.readOnlyHint, false);
  assert.equal(tools.upload_input.annotations.destructiveHint, false);
  assert.equal(tools.upload_input.annotations.openWorldHint, true);
  assert.deepEqual(generateInputSchema.properties.confirm, { type: 'boolean', const: true });
  assert.deepEqual(generateInputSchema.required, ['model', 'prompt', 'quote_token', 'confirm', 'idempotency_key']);
  assert.equal(getJobInputSchema.additionalProperties, false);
});

test('RELEASE-POS-002 local MCP discovery is public and does not forward incidental credentials', async (t) => {
  const gateway = await startGateway();
  t.after(() => gateway.close());
  const metadata = await requestJson(gateway.baseUrl, '/.well-known/oauth-protected-resource/mcp');
  assert.equal(metadata.response.status, 200);
  assert.deepEqual(metadata.body.authorization_servers, ['https://issuer.fixture.invalid']);

  const initialized = await postMcp(gateway.baseUrl, initializeRequest(), { authorization: 'Bearer release-fixture-access-alice' });
  assert.equal(initialized.response.status, 200);
  const listed = await postMcp(gateway.baseUrl, mcpRequest(2, 'tools/list'));
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.result.tools.length, 8);
  const discovered = await postMcp(gateway.baseUrl, mcpRequest(3, 'tools/call', { name: 'list_models', arguments: {} }), { authorization: 'Bearer release-fixture-access-alice' });
  assert.equal(discovered.response.status, 200);
  assert.equal(discovered.body.result.isError, false);
  const discoveredWithInvalidCredential = await postMcp(
    gateway.baseUrl,
    mcpRequest(4, 'tools/call', { name: 'list_models', arguments: {} }),
    { authorization: 'not-a-valid-credential' },
  );
  assert.equal(discoveredWithInvalidCredential.response.status, 200);
  assert.equal(discoveredWithInvalidCredential.body.result.isError, false);
  assert.deepEqual(gateway.calls, [['getPricing', undefined], ['getPricing', undefined]]);
});

test('RELEASE-POS-003 quote-first confirmation flow submits a zero-cost local generation exactly once', async () => {
  const { tools, calls } = createToolHarness();
  const quote = await tools.quote_generation.execute({ model: RELEASE_MODEL, kind: 'image', parameters: generationInput.parameters }, aliceContext);
  assert.equal(quote.ok, true);
  const result = await tools.generate_image.execute(generationInput, aliceContext);
  assert.equal(result.ok, true);
  assert.equal(result.data.job_id, RELEASE_JOB_ID);
  assert.equal(calls.filter(([name]) => name === 'generate').length, 1);
  const submission = calls.find(([name]) => name === 'generate');
  assert.equal(submission[3].confirm, undefined, 'confirmation is gateway intent, not provider input');
  assert.equal(submission[3].quote_token, RELEASE_QUOTE_TOKEN);
});

test('RELEASE-POS-004 idempotency is atomic under local concurrency and replays without a second submission', async () => {
  const { tools, calls } = createToolHarness({ providerDelayMs: 15 });
  const results = await Promise.all(Array.from({ length: 32 }, (_, index) => tools.generate_image.execute({ ...generationInput, idempotency_key: RELEASE_IDEMPOTENCY_KEY }, { ...aliceContext, requestId: `release-concurrent-${index}` })));
  const successes = results.filter((result) => result.ok);
  const conflicts = results.filter((result) => !result.ok && result.error.code === 'RATE_LIMITED');
  assert.equal(successes.length, 1);
  assert.equal(conflicts.length, 31);
  assert.equal(calls.filter(([name]) => name === 'generate').length, 1);
  const replay = await tools.generate_image.execute(generationInput, { ...aliceContext, requestId: 'release-replay-001' });
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, generationJob);
  assert.equal(calls.filter(([name]) => name === 'generate').length, 1);
});

test('RELEASE-POS-005 ownership permits the owner and checks file ownership before provider submission', async () => {
  const { tools, calls } = createToolHarness();
  const result = await tools.generate_image.execute({ ...generationInput, input_file_ids: [RELEASE_FILE_ID] }, aliceContext);
  assert.equal(result.ok, true);
  const job = await tools.get_job.execute({ job_id: RELEASE_JOB_ID }, aliceContext);
  assert.equal(job.ok, true);
  assert.equal(job.data.job_id, RELEASE_JOB_ID);
  assert.equal(calls.filter(([name]) => name === 'generate').length, 1);
  assert.equal(calls.filter(([name]) => name === 'getJob').length, 1);
});

test('RELEASE-POS-006 local load model handles concurrent public catalog reads without external calls', async () => {
  const { tools, calls } = createToolHarness();
  const results = await Promise.all(Array.from({ length: 64 }, () => tools.list_models.execute({}, publicContext)));
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(calls.filter(([name]) => name === 'getPricing').length, 64);
  assert.equal(calls.some(([, subject]) => subject !== undefined), false);
});

test('RELEASE-NEG-001 protected discovery boundary returns 401 and performs no provider work without credentials', async (t) => {
  const gateway = await startGateway();
  t.after(() => gateway.close());
  const result = await postMcp(gateway.baseUrl, mcpRequest(11, 'tools/call', { name: 'get_balance', arguments: {} }));
  assert.equal(result.response.status, 401);
  assert.match(result.response.headers.get('www-authenticate'), /resource_metadata=/);
  assert.equal(result.body.error.data.code, 'AUTH_REQUIRED');
  assertNoProviderNetwork(gateway.calls);
});

test('RELEASE-NEG-002 invalid confirmation and unknown fields fail before quote, idempotency, or provider work', async () => {
  const { tools, calls } = createToolHarness();
  const falseConfirmation = await tools.generate_image.execute({ ...generationInput, confirm: false }, aliceContext);
  const unknownField = await tools.generate_image.execute({ ...generationInput, unexpected: 'reject-me' }, aliceContext);
  assert.equal(falseConfirmation.ok, false);
  assert.equal(falseConfirmation.error.code, 'INVALID_INPUT');
  assert.equal(unknownField.ok, false);
  assert.equal(unknownField.error.code, 'INVALID_INPUT');
  assert.equal(calls.some(([name]) => ['generate', 'quoteGeneration'].includes(name)), false);
});

test('RELEASE-NEG-003 quote binding, expiry, and cross-account ownership failures are fail-closed', async () => {
  const { tools, calls } = createToolHarness();
  const changedParameters = await tools.generate_image.execute({ ...generationInput, parameters: { width: 2048, height: 2048 } }, aliceContext);
  assert.equal(changedParameters.ok, false);
  assert.equal(changedParameters.error.code, 'INVALID_QUOTE');

  const expired = createToolHarness({ quoteOverrides: { expiresAtEpochSeconds: RELEASE_EPOCH_SECONDS } });
  const expiredResult = await expired.tools.generate_image.execute(generationInput, aliceContext);
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.error.code, 'INVALID_QUOTE');

  const foreignJob = await tools.get_job.execute({ job_id: RELEASE_JOB_ID }, bobContext);
  assert.equal(foreignJob.ok, false);
  assert.equal(foreignJob.error.code, 'RESOURCE_FORBIDDEN');
  assert.equal(calls.filter(([name]) => name === 'getJob').length, 0);
  assert.equal(calls.filter(([name]) => name === 'generate').length, 0);
});

test('RELEASE-NEG-004 redaction removes credentials, prompt/media content, quote, and signed URL secrets', () => {
  const headers = redactHeaders({ authorization: 'Bearer release-fixture-access-alice', cookie: 'release-session', 'x-request-id': 'release-request-001' });
  assert.equal(headers.authorization, '[REDACTED]');
  assert.equal(headers.cookie, '[REDACTED]');
  assert.equal(headers['x-request-id'], 'release-request-001');
  const serialized = JSON.stringify(redactLogValue({
    access_token: 'release-fixture-access-alice',
    quote_token: RELEASE_QUOTE_TOKEN,
    prompt: RELEASE_PROMPT,
    media_bytes: 'private-release-media',
    result: 'https://cdn.fixture.invalid/result?signed=release-secret#fragment-secret',
  }));
  for (const secret of [
    'release-fixture-access-alice',
    RELEASE_QUOTE_TOKEN,
    RELEASE_PROMPT,
    'private-release-media',
    'release-secret',
    'fragment-secret',
  ]) assert.equal(serialized.includes(secret), false);
  assert.equal(redactUrl('https://cdn.fixture.invalid/result?signed=release-secret').includes('release-secret'), false);
});

test('RELEASE-NEG-005 local harness never requires a Varoriya credential or non-zero credit', async () => {
  const { tools, calls } = createToolHarness();
  const balance = await tools.get_balance.execute({}, aliceContext);
  assert.equal(balance.ok, true);
  assert.deepEqual(balance.data.balance, { amount: '0', currency: 'CRD' });
  assert.equal(calls.some(([name]) => name === 'generate'), false);
  assert.equal(calls.some(([, , input]) => input?.api_key || input?.credential), false);
});
