import test from 'node:test';
import assert from 'node:assert/strict';
import { assertResourceOwner, assertScopes } from '../src/auth/authorization.ts';
import { extractBearerToken } from '../src/auth/bearer.ts';
import { OAuthAuthenticator } from '../src/auth/oauth.ts';
import { FIXED_EPOCH_SECONDS, aliceContext } from '../test-fixtures/sev1-fixtures.mjs';
import { rejectsCode, throwsCode } from './support/assertions.mjs';

const oauthConfig = Object.freeze({
  issuer: 'https://issuer.fixture.test',
  audiences: ['varoriya-mcp'],
  allowedAlgorithms: ['RS256'],
  resourceOwnerClaim: 'sub',
  clockToleranceSeconds: 0,
});

function claims(overrides = {}) {
  return {
    iss: oauthConfig.issuer,
    aud: 'varoriya-mcp',
    sub: 'user-alice',
    exp: FIXED_EPOCH_SECONDS + 100,
    scope: 'generation:read generation:create files:write',
    ...overrides,
  };
}

test('SEV-1 bearer authentication fails closed for missing, folded, malformed, and control-character credentials', async () => {
  assert.equal(extractBearerToken({ authorization: 'Bearer fixture-token-alice' }), 'fixture-token-alice');
  await rejectsCode(async () => extractBearerToken({}), 'AUTH_REQUIRED');
  await rejectsCode(async () => extractBearerToken({ authorization: ['Bearer a', 'Bearer b'] }), 'INVALID_TOKEN');
  await rejectsCode(async () => extractBearerToken({ authorization: 'Basic fixture-token-alice' }), 'INVALID_TOKEN');
  await rejectsCode(async () => extractBearerToken({ authorization: 'Bearer fixture-token\n-alice' }), 'INVALID_TOKEN');
});

test('SEV-1 OAuth validates issuer, audience, algorithm, expiry, not-before, subject, and scope syntax', async () => {
  const calls = [];
  const authenticator = new OAuthAuthenticator(oauthConfig, {
    async verify(token, request) {
      calls.push({ token, request });
      return { algorithm: 'RS256', claims: claims() };
    },
  }, { now: () => FIXED_EPOCH_SECONDS });
  const context = await authenticator.authenticate({ authorization: 'Bearer fixture-token-alice' });
  assert.equal(context.userId, 'user-alice');
  assert.ok(context.scopes.has('generation:create'));
  assert.equal(calls[0].request.nowEpochSeconds, FIXED_EPOCH_SECONDS);

  const invalid = [
    { algorithm: 'none', claims: claims() },
    { algorithm: 'RS256', claims: claims({ iss: 'https://evil.fixture.test' }) },
    { algorithm: 'RS256', claims: claims({ aud: 'another-audience' }) },
    { algorithm: 'RS256', claims: claims({ exp: FIXED_EPOCH_SECONDS }) },
    { algorithm: 'RS256', claims: claims({ nbf: FIXED_EPOCH_SECONDS + 1 }) },
    { algorithm: 'RS256', claims: claims({ sub: '' }) },
    { algorithm: 'RS256', claims: claims({ scope: 'generation:create invalid scope!' }) },
  ];
  for (const verified of invalid) {
    const candidate = new OAuthAuthenticator(oauthConfig, { async verify() { return verified; } }, { now: () => FIXED_EPOCH_SECONDS });
    await rejectsCode(() => candidate.authenticate({ authorization: 'Bearer fixture-token-alice' }), 'INVALID_TOKEN');
  }
});

test('SEV-1 scopes and ownership are exact-match and default deny', () => {
  assert.doesNotThrow(() => assertScopes(aliceContext, ['generation:create']));
  throwsCode(() => assertScopes(aliceContext, ['admin:*']), 'INSUFFICIENT_SCOPE');
  throwsCode(() => assertScopes({ ...aliceContext, scopes: new Set(['generation:read']) }, ['generation:create']), 'INSUFFICIENT_SCOPE');
  assert.doesNotThrow(() => assertResourceOwner(aliceContext, 'user-alice'));
  throwsCode(() => assertResourceOwner(aliceContext, 'user-bob'), 'RESOURCE_FORBIDDEN');
  throwsCode(() => assertResourceOwner(aliceContext, undefined), 'RESOURCE_FORBIDDEN');
});
