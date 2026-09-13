import assert from 'node:assert/strict';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const RELEASE_EPOCH_SECONDS = 1_800_000_000;
export const RELEASE_MODEL = 'varoriya-release-fixture-image';
export const RELEASE_QUOTE_TOKEN = 'release-fixture-quote-token-001';
export const RELEASE_IDEMPOTENCY_KEY = 'release-fixture-idempotency-001';
export const RELEASE_JOB_ID = 'release-fixture-job-001';
export const RELEASE_FILE_ID = 'release-fixture-file-001';
export const RELEASE_PROMPT = 'A deterministic release fixture prompt';

export const aliceContext = Object.freeze({
  requestId: 'release-request-alice-001',
  subject: 'release-user-alice',
  accessToken: 'release-fixture-access-alice',
  scopes: new Set(['generation:read', 'generation:create', 'billing:read', 'files:write']),
});

export const bobContext = Object.freeze({
  requestId: 'release-request-bob-001',
  subject: 'release-user-bob',
  accessToken: 'release-fixture-access-bob',
  scopes: new Set(['generation:read', 'generation:create', 'billing:read', 'files:write']),
});

export const publicContext = Object.freeze({
  requestId: 'release-request-public-001',
  scopes: new Set(),
});

export const generationInput = Object.freeze({
  model: RELEASE_MODEL,
  prompt: RELEASE_PROMPT,
  quote_token: RELEASE_QUOTE_TOKEN,
  confirm: true,
  idempotency_key: RELEASE_IDEMPOTENCY_KEY,
  parameters: Object.freeze({ width: 1024, height: 1024 }),
});

export const generationJob = Object.freeze({
  job_id: RELEASE_JOB_ID,
  status: 'queued',
  model: RELEASE_MODEL,
  quoted_cost: Object.freeze({ amount: '0', currency: 'CRD' }),
  next_action: 'Call get_job with this job_id to check progress.',
});

export function quoteClaims(overrides = {}) {
  return {
    quoteId: 'release-fixture-quote-001',
    subject: aliceContext.subject,
    model: RELEASE_MODEL,
    kind: 'image',
    parameters: generationInput.parameters,
    expiresAtEpochSeconds: RELEASE_EPOCH_SECONDS + 3_600,
    maxCost: { amount: '0', currency: 'CRD' },
    ...overrides,
  };
}

export function mcpRequest(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

export function initializeRequest() {
  return mcpRequest(1, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'varoriya-release-harness', version: '1.0.0' },
  });
}

export function jsonResponse(body, status = 200, requestId = 'release-provider-request-001') {
  const headers = new Map([
    ['content-type', 'application/json'],
    ['x-request-id', requestId],
  ]);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return headers.get(name.toLowerCase()) ?? null; } },
    async json() { return body; },
  };
}

export function assertNoProviderNetwork(calls) {
  assert.equal(calls.length, 0, 'release harness must not call an external provider');
}
