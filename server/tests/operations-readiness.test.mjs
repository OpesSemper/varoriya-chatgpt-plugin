import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestCorrelation, correlationHeaders } from '../src/observability/request-correlation.ts';
import { createJsonLogger } from '../src/observability/logger.ts';
import { createOperationsMetrics, METRIC_NAMES } from '../src/observability/metrics.ts';
import { createHealthRegistry } from '../src/health/readiness.ts';

test('SEV-1 operations logging correlates requests and redacts sensitive fields at the output boundary', () => {
  const writes = [];
  const correlation = createRequestCorrelation('edge-request-0001');
  assert.equal(correlation.requestId, 'edge-request-0001');
  assert.deepEqual(correlationHeaders(correlation), { 'x-request-id': 'edge-request-0001' });
  const logger = createJsonLogger({
    service: 'varoriya-mcp',
    environment: 'production',
    now: () => new Date('2026-09-06T00:00:00.000Z'),
    sink: { write(line) { writes.push(line); } },
  }).withCorrelation(correlation);
  logger.log('info', 'tool.completed', {
    tool: 'generate_image',
    authorization: 'Bearer top-secret',
    prompt: 'private prompt',
    result_url: 'https://results.example/file?signature=secret',
  });
  const output = writes.join('');
  assert.equal(output.includes('top-secret'), false);
  assert.equal(output.includes('private prompt'), false);
  assert.equal(output.includes('signature=secret'), false);
  const record = JSON.parse(writes[0]);
  assert.equal(record.request_id, 'edge-request-0001');
  assert.equal(record.authorization, '[REDACTED]');
  assert.equal(record.prompt, '[REDACTED]');
  assert.equal(record.tool, 'generate_image');
  const generated = createRequestCorrelation('invalid request id! ', () => 'generated-00000001');
  assert.equal(generated.requestId, 'generated-00000001');
});

test('SEV-1 operations metrics keep labels low-cardinality and cover gateway decision paths', () => {
  const events = [];
  const metrics = createOperationsMetrics({
    increment(name, labels, value) { events.push({ type: 'increment', name, labels, value }); },
    observe(name, value, labels) { events.push({ type: 'observe', name, labels, value }); },
    gauge(name, value, labels) { events.push({ type: 'gauge', name, labels, value }); },
  });
  metrics.request({ route: 'mcp', status: 503, durationMs: 21 });
  metrics.auth({ mode: 'oauth', outcome: 'invalid' });
  metrics.tool({ tool: 'generate_image', outcome: 'success' });
  metrics.provider({ operation: 'generate', outcome: 'failure', durationMs: 34 });
  metrics.cost({ decision: 'limit_exceeded' });
  metrics.idempotency({ operation: 'generate', outcome: 'replayed' });
  metrics.readiness({ dependency: 'durable-store', ready: false });
  assert.equal(events.some((event) => event.name === METRIC_NAMES.authTotal), true);
  assert.equal(events.some((event) => event.name === METRIC_NAMES.idempotencyTotal), true);
  const request = events.find((event) => event.name === METRIC_NAMES.requestTotal);
  assert.deepEqual(request.labels, { route: 'mcp', status: '5xx' });
  assert.equal(JSON.stringify(events).includes('prompt'), false);
});

test('SEV-1 readiness fails closed only for required dependencies and bounds hanging checks', async () => {
  let clock = 100;
  const registry = createHealthRegistry({
    timeoutMs: 5,
    now: () => ++clock,
    nowIso: () => '2026-09-06T00:00:00.000Z',
    dependencies: [
      { name: 'durable-store', required: true, async check() { throw new Error('unavailable'); } },
      { name: 'telemetry-exporter', required: false, async check() { return undefined; } },
      { name: 'malware-scanner', required: false, check() { return new Promise(() => undefined); } },
    ],
  });
  assert.deepEqual(registry.liveness(), { status: 'alive' });
  const readiness = await registry.readiness();
  assert.equal(readiness.status, 'not_ready');
  assert.deepEqual(
    readiness.dependencies.map((dependency) => [dependency.name, dependency.state]),
    [['durable-store', 'fail'], ['telemetry-exporter', 'pass'], ['malware-scanner', 'fail']],
  );
  assert.equal(JSON.stringify(readiness).includes('unavailable'), false);
});
