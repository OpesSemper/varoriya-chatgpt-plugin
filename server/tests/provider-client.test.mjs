import test from 'node:test';
import assert from 'node:assert/strict';
import { VaroriyaApiClient, VaroriyaApiError } from '../src/varoriya-api/client.ts';
import { aliceContext, generationJob } from '../test-fixtures/sev1-fixtures.mjs';
import { jsonResponse } from './support/assertions.mjs';

test('SEV-1 provider client parses success envelopes and sends correlation, authorization, and idempotency headers', async () => {
  const calls = [];
  const client = new VaroriyaApiClient({
    baseUrl: 'https://api.varoriya.test',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ data: generationJob }, 200, 'provider-request-success-001');
    },
  });
  const result = await client.generate(aliceContext, 'image', {
    model: 'varoriya-image-fixture',
    prompt: 'fixture prompt',
    quote_token: 'quote-token-fixture-image-001',
    idempotency_key: 'idem-fixture-provider-001',
  });
  assert.deepEqual(result, generationJob);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.varoriya.test/v1/generate/image');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer fixture-token-alice');
  assert.equal(calls[0].init.headers['X-Request-Id'], aliceContext.requestId);
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'idem-fixture-provider-001');
});

test('SEV-1 provider HTTP statuses and error envelopes map to stable safe errors', async () => {
  const cases = [
    [401, {}, 'AUTH_REQUIRED', false],
    [403, {}, 'RESOURCE_FORBIDDEN', false],
    [404, {}, 'JOB_NOT_FOUND', false],
    [409, {}, 'PRICE_CHANGED', false],
    [422, {}, 'INVALID_INPUT', false],
    [429, {}, 'RATE_LIMITED', true],
    [503, {}, 'PROVIDER_UNAVAILABLE', true],
    [500, { error: { code: 'INSUFFICIENT_BALANCE', message: 'private provider detail' } }, 'INSUFFICIENT_BALANCE', false],
  ];
  for (const [status, body, code, recoverable] of cases) {
    const client = new VaroriyaApiClient({
      baseUrl: 'https://api.varoriya.test',
      fetch: async () => jsonResponse(body, status, `provider-request-${status}`),
    });
    await assert.rejects(() => client.getJob(aliceContext, 'job-fixture-alice-001'), (error) => {
      assert.ok(error instanceof VaroriyaApiError);
      assert.equal(error.code, code);
      assert.equal(error.recoverable, recoverable);
      assert.equal(error.requestId, `provider-request-${status}`);
      assert.equal(error.message.includes('private provider detail'), false);
      return true;
    });
  }
});

test('SEV-1 malformed success envelopes fail closed as provider unavailable', async () => {
  const client = new VaroriyaApiClient({
    baseUrl: 'https://api.varoriya.test',
    fetch: async () => jsonResponse({ data: { status: 'queued' } }, 200, 'provider-request-malformed-001'),
  });
  await assert.rejects(() => client.getJob(aliceContext, 'job-fixture-alice-001'), (error) => {
    assert.ok(error instanceof VaroriyaApiError);
    assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
    assert.equal(error.recoverable, true);
    return true;
  });
});
