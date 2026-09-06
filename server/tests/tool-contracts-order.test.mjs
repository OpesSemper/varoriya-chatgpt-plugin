import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/errors.ts';
import { createVaroriyaTools } from '../src/tools/handlers.ts';
import { generateInputSchema, getBalanceInputSchema } from '../src/tools/schemas.ts';
import { aliceContext, generationInput, generationJob } from '../test-fixtures/sev1-fixtures.mjs';
import { toolFailure } from './support/assertions.mjs';

function createSpyTools(calls, { denyScope = false } = {}) {
  return createVaroriyaTools({
    client: {
      async getPricing() { calls.push('provider.pricing'); return { models: [] }; },
      async quoteGeneration() { calls.push('provider.quote'); return {}; },
      async getMe() { calls.push('provider.balance'); return {}; },
      async uploadFile() { calls.push('provider.upload'); return {}; },
      async generate() { calls.push('provider.generate'); return generationJob; },
      async getJob() { calls.push('provider.getJob'); return generationJob; },
    },
    guards: {
      async requireScope() {
        calls.push('guard.scope');
        if (denyScope) {
          throw new AppError('INSUFFICIENT_SCOPE', {
            status: 403,
            message: 'The access token does not grant the required permission.',
          });
        }
      },
      async validateQuote() {
        calls.push('guard.quote');
        return { subject: aliceContext.subject, token: generationInput.quote_token, model: generationInput.model, kind: 'image', parameters: generationInput.parameters, expiresAt: '2099-01-01T00:00:00.000Z' };
      },
      async acquireIdempotency() {
        calls.push('guard.idempotency');
        return { async complete() { calls.push('guard.complete'); } };
      },
      async assertJobOwnership() { calls.push('guard.job-owner'); },
      async assertFileOwnership() { calls.push('guard.file-owner'); },
    },
    isModelAllowed: async () => { calls.push('policy.model'); return true; },
    validateGenerationParameters: async (_context, _model, _kind, parameters) => {
      calls.push('policy.parameters');
      return parameters;
    },
    validateUpload: async () => { calls.push('policy.upload'); },
  });
}

test('SEV-1 tool registry exposes exact tools, closed schemas, and safety annotations', () => {
  const tools = createSpyTools([]);
  const expected = [
    'generate_audio', 'generate_image', 'generate_video', 'get_balance',
    'get_job', 'list_models', 'quote_generation', 'upload_input',
  ];
  assert.deepEqual(Object.keys(tools).sort(), expected);
  assert.equal(tools.unknown_tool, undefined);
  for (const name of ['generate_image', 'generate_video', 'generate_audio']) {
    assert.equal(tools[name].annotations.destructiveHint, true);
    assert.equal(tools[name].annotations.openWorldHint, true);
    assert.equal(tools[name].inputSchema.additionalProperties, false);
  }
  for (const name of ['list_models', 'quote_generation', 'get_balance', 'get_job']) {
    assert.equal(tools[name].annotations.readOnlyHint, true);
  }
  assert.equal(tools.upload_input.annotations.destructiveHint, true);
  assert.equal(tools.upload_input.annotations.openWorldHint, true);
  assert.deepEqual(generateInputSchema.required, ['model', 'prompt', 'quote_token', 'confirm', 'idempotency_key']);
  assert.deepEqual(generateInputSchema.properties.confirm, { type: 'boolean', const: true });
  assert.equal(getBalanceInputSchema.additionalProperties, false);
});

test('SEV-1 tool selection maps explicit media intent only and fails closed for unknown intent', () => {
  const tools = createSpyTools([]);
  const fixtures = [
    ['image', 'generate_image'],
    ['video', 'generate_video'],
    ['audio', 'generate_audio'],
  ];
  for (const [kind, expected] of fixtures) {
    const selected = tools[`generate_${kind}`];
    assert.equal(selected.name, expected);
  }
  assert.equal(tools.generate_unknown, undefined);
});

test('SEV-1 runtime schemas reject unknown fields, false confirmation, empty prompt, and malformed resource IDs', async () => {
  const tools = createSpyTools([]);
  toolFailure(await tools.generate_image.execute({ ...generationInput, unexpected: true }, aliceContext), 'INVALID_INPUT');
  toolFailure(await tools.generate_image.execute({ ...generationInput, confirm: false }, aliceContext), 'INVALID_INPUT');
  toolFailure(await tools.generate_image.execute({ ...generationInput, prompt: '' }, aliceContext), 'INVALID_INPUT');
  toolFailure(await tools.get_job.execute({ job_id: '../other-account' }, aliceContext), 'INVALID_INPUT');
});

test('SEV-1 get_job invokes scope, ownership, and provider read in that order', async () => {
  const calls = [];
  const result = await createSpyTools(calls).get_job.execute({ job_id: 'job-fixture-alice-001' }, aliceContext);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['guard.scope', 'guard.job-owner', 'provider.getJob']);
});

test('SEV-1 authorization failure stops ownership lookup and provider access', async () => {
  const calls = [];
  const result = await createSpyTools(calls, { denyScope: true }).get_job.execute({ job_id: 'job-fixture-alice-001' }, aliceContext);
  toolFailure(result, 'INSUFFICIENT_SCOPE');
  assert.deepEqual(calls, ['guard.scope']);
});

test('SEV-1 generation checks file ownership before idempotency and provider submission', async () => {
  const calls = [];
  const result = await createSpyTools(calls).generate_image.execute({ ...generationInput, input_file_ids: ['file-fixture-001'] }, aliceContext);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    'guard.scope',
    'policy.model',
    'policy.parameters',
    'guard.quote',
    'guard.file-owner',
    'guard.idempotency',
    'provider.generate',
    'guard.complete',
  ]);
});
