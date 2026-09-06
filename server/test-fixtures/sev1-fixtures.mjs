export const FIXED_EPOCH_SECONDS = 1_700_000_000;

export const aliceContext = Object.freeze({
  requestId: 'request-fixture-alice-001',
  subject: 'user-alice',
  accessToken: 'fixture-token-alice',
  scopes: new Set(['generation:read', 'generation:create', 'billing:read', 'files:write']),
});

export const bobContext = Object.freeze({
  requestId: 'request-fixture-bob-001',
  subject: 'user-bob',
  accessToken: 'fixture-token-bob',
  scopes: new Set(['generation:read', 'generation:create', 'billing:read', 'files:write']),
});

export const publicContext = Object.freeze({
  requestId: 'request-fixture-public-001',
  scopes: new Set(),
});

export const generationInput = Object.freeze({
  model: 'varoriya-image-fixture',
  prompt: 'A deterministic fixture prompt',
  quote_token: 'quote-token-fixture-image-001',
  confirm: true,
  idempotency_key: 'idem-fixture-generation-001',
  parameters: Object.freeze({}),
});

export const generationJob = Object.freeze({
  job_id: 'job-fixture-alice-001',
  status: 'queued',
  model: 'varoriya-image-fixture',
  quoted_cost: Object.freeze({ amount: '12', currency: 'CRD' }),
  next_action: 'Call get_job with this job_id to check progress.',
});

export function quoteClaims(overrides = {}) {
  return {
    quoteId: 'quote-fixture-image-001',
    subject: 'user-alice',
    model: 'varoriya-image-fixture',
    kind: 'image',
    parameters: generationInput.parameters,
    expiresAtEpochSeconds: 4_102_444_800,
    maxCost: { amount: '12', currency: 'CRD' },
    ...overrides,
  };
}

export function pngBytes(length = 16) {
  if (length < 8) throw new Error('PNG fixture requires at least eight bytes');
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...new Array(length - 8).fill(0),
  ]);
}
