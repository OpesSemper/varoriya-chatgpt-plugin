import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaroriyaTools } from '../src/tools/handlers.ts';
import { VaroriyaApiClient } from '../src/varoriya-api/client.ts';
import { GenerationSecurityGuards } from '../src/policy/generation-guards.ts';
import { IdempotencyPolicy, InMemoryIdempotencyStore } from '../src/policy/idempotency.ts';
import { InMemoryOwnershipStore, OwnershipPolicy } from '../src/policy/ownership.ts';
import { QuoteValidationPolicy } from '../src/policy/quote.ts';
import { ScopePolicy } from '../src/policy/scope.ts';
import {
  FIXED_EPOCH_SECONDS,
  aliceContext,
  generationInput,
  generationJob,
  quoteClaims,
} from '../test-fixtures/sev1-fixtures.mjs';
import { jsonResponse, rejectsCode, toolFailure } from './support/assertions.mjs';

function createHarness(fetchImpl, quoteOverrides = {}) {
  const verifier = {
    async verify(token) {
      if (token !== generationInput.quote_token) throw new Error('unknown quote');
      return quoteClaims(quoteOverrides);
    },
  };
  const guards = new GenerationSecurityGuards({
    scopes: new ScopePolicy(),
    quotes: new QuoteValidationPolicy(verifier),
    idempotency: new IdempotencyPolicy(new InMemoryIdempotencyStore('test')),
    ownership: new OwnershipPolicy(new InMemoryOwnershipStore('test')),
  });
  const client = new VaroriyaApiClient({ baseUrl: 'https://api.varoriya.test', fetch: fetchImpl });
  const tools = createVaroriyaTools({
    client,
    guards,
    isModelAllowed: async () => true,
    validateGenerationParameters: async (_context, _model, _kind, parameters) => parameters,
    validateUpload: async () => undefined,
  });
  return { guards, tools };
}

test('SEV-1 quote confirmation policy binds token to subject, model, kind, parameters, and expiry', async () => {
  const policy = new QuoteValidationPolicy({ async verify() { return quoteClaims(); } }, { now: () => FIXED_EPOCH_SECONDS });
  const valid = await policy.validate(aliceContext, generationInput.quote_token, { model: generationInput.model, kind: 'image', parameters: generationInput.parameters });
  assert.equal(valid.subject, aliceContext.subject);
  assert.equal(valid.token, generationInput.quote_token);
  await rejectsCode(() => policy.validate({ ...aliceContext, subject: 'user-bob' }, generationInput.quote_token, { model: generationInput.model, kind: 'image', parameters: generationInput.parameters }), 'INVALID_QUOTE');
  await rejectsCode(() => policy.validate(aliceContext, generationInput.quote_token, { model: 'other-model', kind: 'image', parameters: generationInput.parameters }), 'INVALID_QUOTE');
  await rejectsCode(() => policy.validate(aliceContext, generationInput.quote_token, { model: generationInput.model, kind: 'video', parameters: generationInput.parameters }), 'INVALID_QUOTE');
  await rejectsCode(() => policy.validate(aliceContext, generationInput.quote_token, { model: generationInput.model, kind: 'image', parameters: { width: 1024 } }), 'INVALID_QUOTE');
  const expired = new QuoteValidationPolicy({ async verify() { return quoteClaims({ expiresAtEpochSeconds: FIXED_EPOCH_SECONDS }); } }, { now: () => FIXED_EPOCH_SECONDS });
  await rejectsCode(() => expired.validate(aliceContext, generationInput.quote_token, { model: generationInput.model, kind: 'image', parameters: generationInput.parameters }), 'INVALID_QUOTE');
});

test('SEV-1 generation rejects missing confirmation before guards or provider POST', async () => {
  const requests = [];
  const { tools } = createHarness(async (url, init) => {
    requests.push({ url, init });
    return jsonResponse({ data: generationJob });
  });
  const result = await tools.generate_image.execute({ ...generationInput, confirm: false }, aliceContext);
  toolFailure(result, 'INVALID_INPUT');
  assert.equal(requests.length, 0);
});

test('SEV-1 completed idempotency key replays the job with exactly one provider POST', async () => {
  const requests = [];
  const { tools } = createHarness(async (url, init) => {
    requests.push({ url, init });
    return jsonResponse({ data: generationJob }, 200, 'provider-request-generation-001');
  });
  const first = await tools.generate_image.execute(generationInput, aliceContext);
  const replay = await tools.generate_image.execute(generationInput, { ...aliceContext, requestId: 'request-fixture-replay-001' });
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.data, first.data);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers['Idempotency-Key'], generationInput.idempotency_key);
});

test('SEV-1 in-memory idempotency and ownership stores cannot be constructed for production', () => {
  assert.throws(() => new InMemoryIdempotencyStore('production'), (error) => error?.code === 'CONFIG_INVALID');
  assert.throws(() => new InMemoryOwnershipStore('production'), (error) => error?.code === 'CONFIG_INVALID');
});
