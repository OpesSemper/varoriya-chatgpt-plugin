import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import test from 'node:test';

import { loadConfig } from '../src/config.ts';
import { ClamAvScanner } from '../src/infrastructure/clamav-scanner.ts';
import { PostgresCostLimitStore } from '../src/infrastructure/postgres/cost-limit-store.ts';
import { PostgresIdempotencyStore } from '../src/infrastructure/postgres/idempotency-store.ts';
import { PostgresOwnershipStore } from '../src/infrastructure/postgres/ownership-store.ts';
import { PostgresQuoteStore } from '../src/infrastructure/postgres/quote-store.ts';
import { createProductionSecurity } from '../src/infrastructure/production-security.ts';
import { quoteDigest } from '../src/infrastructure/security-values.ts';
import { loadRuntimeConfig } from '../src/runtime.ts';

const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: 'production',
  VARORIYA_AUTH_MODE: 'oauth',
  VARORIYA_OAUTH_ISSUER: 'https://issuer.fixture.invalid',
  VARORIYA_OAUTH_AUDIENCES: 'varoriya-gateway',
  VARORIYA_OAUTH_JWKS_URI: 'https://issuer.fixture.invalid/.well-known/jwks.json',
  PUBLIC_ORIGIN: 'https://plugin.fixture.invalid',
  DATABASE_URL: 'postgresql://gateway:fixture-only@database.fixture.invalid/varoriya',
  CLAMAV_HOST: 'clamav.fixture.invalid',
  VARORIYA_COST_CURRENCY: 'CRD',
  VARORIYA_MODEL_POLICIES_JSON: JSON.stringify([
    {
      model: 'fixture-image-v1',
      kinds: ['image'],
      requiredScopes: ['generation:create'],
      allowedParameterKeys: ['height', 'width'],
    },
  ]),
});

test('SEV-0 production composition requires durable dependencies and exact model policy', async () => {
  const database = scriptedDatabase([]);
  const scanner = { async scan() { return { verdict: 'clean' }; } };
  const appConfig = loadConfig(PRODUCTION_ENV);
  const runtime = loadRuntimeConfig(PRODUCTION_ENV);
  const security = createProductionSecurity(appConfig, runtime, { database, malwareScanner: scanner });
  const allowedContext = {
    requestId: 'request-production-001',
    subject: 'publisher-fixture-user',
    accessToken: 'fixture-access-token',
    scopes: new Set(['generation:create']),
  };

  assert.equal(security.isModelAllowed(allowedContext, 'fixture-image-v1', 'image'), true);
  assert.equal(security.isModelAllowed(allowedContext, 'fixture-image-v1', 'video'), false);
  assert.equal(
    security.isModelAllowed(
      { requestId: 'request-public-001', scopes: new Set() },
      'fixture-image-v1',
      'image',
    ),
    true,
  );
  assert.equal(
    security.isModelAllowed(
      { ...allowedContext, scopes: new Set() },
      'fixture-image-v1',
      'image',
    ),
    false,
  );
  assert.deepEqual(
    security.validateGenerationParameters(
      allowedContext,
      'fixture-image-v1',
      'image',
      { width: 1024, height: 1024 },
    ),
    { height: 1024, width: 1024 },
  );
  assert.throws(
    () => security.validateGenerationParameters(
      allowedContext,
      'fixture-image-v1',
      'image',
      { seed: 1 },
    ),
    (error) => error?.code === 'INVALID_INPUT',
  );
  assert.throws(
    () => createProductionSecurity(
      { ...appConfig, environment: 'test' },
      runtime,
      { database, malwareScanner: scanner },
    ),
    (error) => error?.code === 'CONFIG_INVALID',
  );
});

test('SEV-0 PostgreSQL ownership adapter parameterizes writes, prevents reassignment, and fails closed', async () => {
  const owner = 'publisher-fixture-user';
  const database = scriptedDatabase([
    { marker: 'ownership-insert', rows: [], check: (parameters) => assert.deepEqual(parameters, ['file', 'file-production-001', owner]) },
    { marker: 'ownership-find', rows: [{ resource_id: 'file-production-001', subject: owner }] },
  ]);
  const store = new PostgresOwnershipStore(database);
  await store.bindFile('file-production-001', owner);
  database.assertDone();
  assert.equal(database.transactions[0]?.isolationLevel, 'read committed');
  assert.equal(database.calls.every((call) => call.text.includes('$1')), true);

  const conflicting = scriptedDatabase([
    { marker: 'ownership-insert', rows: [] },
    { marker: 'ownership-find', rows: [{ resource_id: 'file-production-001', subject: 'another-user' }] },
  ]);
  await assert.rejects(
    () => new PostgresOwnershipStore(conflicting).bindFile('file-production-001', owner),
    (error) => error?.code === 'RESOURCE_FORBIDDEN',
  );

  const unavailable = {
    async query() { throw new Error('database details must stay internal'); },
    async transaction(operation) { return operation(this); },
  };
  await assert.rejects(
    () => new PostgresOwnershipStore(unavailable).getJobOwner('job-production-001'),
    (error) => error?.code === 'PROVIDER_UNAVAILABLE' && !error.message.includes('database details'),
  );
});

test('SEV-0 quote verification stores only a digest and reserves spend in one serializable transaction', async () => {
  const token = 'quote-token-production-000001';
  const tokenHash = quoteDigest(token);
  const parameters = { width: 1024, height: 1024 };
  const quote = {
    quote_token: token,
    model: 'fixture-image-v1',
    kind: 'image',
    estimated_cost: { amount: '1.25', currency: 'CRD' },
    expires_at: '2030-03-17T17:46:40.000Z',
    parameters,
  };
  const quoteRow = {
    token_hash: tokenHash,
    quote_id: tokenHash,
    subject: 'publisher-fixture-user',
    model: quote.model,
    kind: quote.kind,
    parameters_payload: { height: 1024, width: 1024 },
    expires_at_epoch_seconds: 1_900_000_000,
    cost_amount: '1.25',
    cost_currency: 'CRD',
    cost_units: 1_250_000,
  };
  const nowSeconds = 1_800_000_000;
  const windowStart = nowSeconds * 1_000;
  const resetAt = windowStart + 3_600_000;
  const database = scriptedDatabase([
    {
      marker: 'quote-insert',
      rows: [],
      check(parametersList) {
        assert.equal(parametersList[0], tokenHash);
        assert.equal(parametersList.includes(token), false);
      },
    },
    { marker: 'quote-find', rows: [quoteRow] },
    { marker: 'quote-find', rows: [quoteRow], check: (_parameters, text) => assert.match(text, /FOR UPDATE/) },
    { marker: 'cost-window-insert', rows: [] },
    {
      marker: 'cost-window-lock',
      rows: [{ consumed_units: 0, limit_units: 5_000_000, reset_at_ms: resetAt }],
    },
    { marker: 'cost-reservation-find', rows: [] },
    {
      marker: 'cost-window-consume',
      rows: [{ consumed_units: 1_250_000, limit_units: 5_000_000, reset_at_ms: resetAt }],
    },
    {
      marker: 'cost-reservation-insert',
      rows: [],
      check(parametersList) {
        assert.equal(parametersList[2], `${tokenHash}:idempotency-production-000001`);
        assert.equal(parametersList[3], 'request-production-001');
      },
    },
  ]);
  const costConfig = {
    currency: 'CRD',
    maxRequestCostUnits: 2_000_000,
    maxUserCostUnitsPerWindow: 5_000_000,
    windowSeconds: 3_600,
  };
  const costStore = new PostgresCostLimitStore(database);
  const quoteStore = new PostgresQuoteStore(database, costStore, costConfig);

  await quoteStore.record('publisher-fixture-user', quote, parameters);
  const claims = await quoteStore.verify(token, nowSeconds, {
    requestId: 'request-production-001',
    reservationKey: 'idempotency-production-000001',
  });
  assert.equal(claims.quoteId, tokenHash);
  assert.equal(claims.subject, 'publisher-fixture-user');
  assert.deepEqual(claims.parameters, { height: 1024, width: 1024 });
  assert.deepEqual(claims.maxCost, { amount: '1.25', currency: 'CRD' });
  assert.deepEqual(database.transactions.map((entry) => entry.isolationLevel), ['read committed', 'serializable']);
  database.assertDone();
});

test('SEV-0 duplicate cost reservation tolerates a new correlation ID without consuming twice', async () => {
  const nowEpochMilliseconds = 1_800_000_000_000;
  const resetAt = nowEpochMilliseconds + 3_600_000;
  const database = scriptedDatabase([
    { marker: 'cost-window-insert', rows: [] },
    { marker: 'cost-window-lock', rows: [{ consumed_units: 1_250_000, limit_units: 5_000_000, reset_at_ms: resetAt }] },
    { marker: 'cost-reservation-find', rows: [{ cost_units: 1_250_000, request_id: 'original-correlation' }] },
  ]);
  const result = await new PostgresCostLimitStore(database).reserve({
    userId: 'publisher-fixture-user',
    requestId: 'retry-correlation',
    reservationKey: 'quote-and-idempotency-reservation-001',
    costUnits: 1_250_000,
    limitUnits: 5_000_000,
    windowSeconds: 3_600,
    nowEpochMilliseconds,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.consumedUnits, 1_250_000);
  database.assertDone();
});

test('SEV-0 zero-cost sandbox quote verifies without creating a cost reservation', async () => {
  const token = 'quote-token-no-credit-000001';
  const tokenHash = quoteDigest(token);
  const quote = {
    quote_token: token,
    model: 'fixture-image-v1',
    kind: 'image',
    estimated_cost: { amount: '0', currency: 'CRD' },
    expires_at: '2030-03-17T17:46:40.000Z',
    parameters: { width: 512 },
  };
  const row = {
    token_hash: tokenHash,
    quote_id: tokenHash,
    subject: 'publisher-fixture-user',
    model: quote.model,
    kind: quote.kind,
    parameters_payload: { width: 512 },
    expires_at_epoch_seconds: 1_900_000_000,
    cost_amount: '0',
    cost_currency: 'CRD',
    cost_units: 0,
  };
  const database = scriptedDatabase([
    { marker: 'quote-insert', rows: [] },
    { marker: 'quote-find', rows: [row] },
    { marker: 'quote-find', rows: [row] },
  ]);
  const costConfig = {
    currency: 'CRD',
    maxRequestCostUnits: 2_000_000,
    maxUserCostUnitsPerWindow: 5_000_000,
    windowSeconds: 3_600,
  };
  const quoteStore = new PostgresQuoteStore(
    database,
    new PostgresCostLimitStore(database),
    costConfig,
  );
  await quoteStore.record('publisher-fixture-user', quote, quote.parameters);
  const claims = await quoteStore.verify(token, 1_800_000_000, {
    requestId: 'request-no-credit-001',
    reservationKey: 'idempotency-no-credit-000001',
  });
  assert.equal(claims.maxCost.amount, '0');
  database.assertDone();
});

test('SEV-0 PostgreSQL idempotency adapter fences completion and replays the persisted job', async () => {
  const job = {
    job_id: 'job-production-001',
    status: 'queued',
    model: 'fixture-image-v1',
    quoted_cost: { amount: '1.25', currency: 'CRD' },
    next_action: 'Poll get_job.',
  };
  const database = scriptedDatabase([
    { marker: 'idempotency-acquire', rows: [{ state: 'reserved' }] },
    { marker: 'idempotency-complete', rows: [{ state: 'completed' }] },
    { marker: 'idempotency-acquire', rows: [] },
    {
      marker: 'idempotency-lock',
      rows: [{
        state: 'completed',
        request_fingerprint: 'f'.repeat(43),
        lease_id: null,
        lease_expires_at_ms: null,
        retain_until_ms: 1_900_000_000_000,
        job_payload: job,
      }],
    },
  ]);
  const store = new PostgresIdempotencyStore(database, { leaseId: () => 'lease-production-001' });
  const request = {
    subject: 'publisher-fixture-user',
    key: 'idempotency-production-000001',
    requestId: 'request-production-001',
    requestFingerprint: 'f'.repeat(43),
    nowEpochMilliseconds: 1_800_000_000_000,
    reservationTtlMilliseconds: 60_000,
    completedRetentionMilliseconds: 120_000,
  };
  const acquired = await store.acquire(request);
  assert.deepEqual(acquired, { status: 'acquired', leaseId: 'lease-production-001' });
  await store.complete(request.subject, request.key, acquired.leaseId, job, request.nowEpochMilliseconds + 1_000);
  const replay = await store.acquire({ ...request, nowEpochMilliseconds: request.nowEpochMilliseconds + 2_000 });
  assert.deepEqual(replay, { status: 'completed', job });
  assert.equal(database.transactions.length, 2);
  database.assertDone();
});

test('SEV-1 ClamAV adapter emits bounded INSTREAM frames and recognizes clean, malicious, and unknown verdicts', async (t) => {
  const fixture = await startClamFixture([
    'PONG\0',
    'stream: OK\0',
    'stream: Eicar-Signature FOUND\0',
    'stream: ERROR\0',
  ]);
  t.after(() => fixture.close());
  const scanner = new ClamAvScanner({ host: '127.0.0.1', port: fixture.port, timeoutMs: 1_000, chunkBytes: 1_024 });

  await scanner.check();
  assert.deepEqual(await scanner.scan(Uint8Array.from([1, 2, 3, 4])), { verdict: 'clean' });
  assert.deepEqual(await scanner.scan(Uint8Array.from([5, 6, 7])), { verdict: 'malicious' });
  assert.deepEqual(await scanner.scan(Uint8Array.from([8])), { verdict: 'unknown' });
  assert.equal(fixture.requests[0]?.toString('ascii'), 'zPING\0');
  assert.equal(fixture.requests[1]?.subarray(0, 10).toString('ascii'), 'zINSTREAM\0');
  assert.equal(fixture.requests[1]?.readUInt32BE(10), 4);
  assert.deepEqual([...fixture.requests[1].subarray(14, 18)], [1, 2, 3, 4]);
  assert.equal(fixture.requests[1]?.readUInt32BE(18), 0);
});

test('SEV-1 production migration keeps quote tokens hashed and defines cleanup targets', async () => {
  const migration = await readFile(new URL('../migrations/001_production_security.up.sql', import.meta.url), 'utf8');
  const cleanup = await readFile(new URL('../migrations/cleanup.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS varoriya_security/);
  assert.match(migration, /token_hash text PRIMARY KEY/);
  assert.doesNotMatch(migration, /quote_token\s+text/i);
  assert.match(migration, /PRIMARY KEY \(subject, idempotency_key\)/);
  assert.match(migration, /request_fingerprint text NOT NULL/);
  assert.match(cleanup, /quote_records/);
  assert.match(cleanup, /idempotency_records/);
});

function scriptedDatabase(steps) {
  let cursor = 0;
  const calls = [];
  const transactions = [];
  const query = async (text, parameters = []) => {
    const step = steps[cursor++];
    assert.ok(step, `Unexpected SQL call: ${text}`);
    assert.match(text, new RegExp(step.marker));
    calls.push({ text, parameters });
    step.check?.(parameters, text);
    if (step.error) throw step.error;
    const rows = step.rows ?? [];
    return { rows, rowCount: rows.length };
  };
  return {
    calls,
    transactions,
    query,
    async transaction(operation, options = {}) {
      transactions.push(options);
      return operation({ query });
    },
    assertDone() {
      assert.equal(cursor, steps.length, `Expected ${steps.length - cursor} more SQL calls.`);
    },
  };
}

async function startClamFixture(responses) {
  const requests = [];
  let responseIndex = 0;
  const server = createServer((socket) => {
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on('end', () => {
      requests.push(Buffer.concat(chunks));
      socket.end(Buffer.from(responses[responseIndex++] ?? 'stream: ERROR\0', 'utf8'));
    });
  });
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
    port: address.port,
    requests,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
