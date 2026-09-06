import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMedia } from '../src/policy/media.ts';
import { UploadValidationPolicy } from '../src/policy/upload.ts';
import { SsrfGuard, isBlockedIpAddress, parseRemoteUrl } from '../src/policy/url.ts';
import { redactHeaders, redactLogValue, redactUrl } from '../src/policy/redaction.ts';
import { aliceContext, pngBytes } from '../test-fixtures/sev1-fixtures.mjs';
import { rejectsCode, throwsCode } from './support/assertions.mjs';

const mediaConfig = Object.freeze({
  allowedMimeTypes: ['image/png', 'image/jpeg'],
  maxUploadBytes: 32,
});
const urlConfig = Object.freeze({
  enabled: true,
  allowedHosts: ['media.varoriya.com', '*.cdn.varoriya.com'],
  allowedPorts: [443],
  maxUrlLength: 2048,
  allowHttp: false,
  allowPublicIpLiterals: false,
});

test('SEV-1 media validation enforces magic MIME, filename, and exact size boundaries', () => {
  const valid = validateMedia({ declaredMimeType: 'image/png', sizeBytes: 16, prefix: pngBytes(16), filename: 'fixture.png' }, mediaConfig);
  assert.equal(valid.mimeType, 'image/png');
  assert.equal(valid.safeFilename, 'fixture.png');
  throwsCode(() => validateMedia({ declaredMimeType: 'image/jpeg', sizeBytes: 16, prefix: pngBytes(16), filename: 'fixture.jpg' }, mediaConfig), 'UNSUPPORTED_MEDIA_TYPE');
  throwsCode(() => validateMedia({ declaredMimeType: 'image/png', sizeBytes: 33, prefix: pngBytes(16), filename: 'fixture.png' }, mediaConfig), 'PAYLOAD_TOO_LARGE');
  throwsCode(() => validateMedia({ declaredMimeType: 'image/png', sizeBytes: 16, prefix: pngBytes(16), filename: '../fixture.png' }, mediaConfig), 'INVALID_INPUT');
});

test('SEV-1 upload policy validates before scanning and fails closed for malformed, oversized, or non-clean media', async () => {
  const scans = [];
  const cleanPolicy = new UploadValidationPolicy(mediaConfig, {
    async scan(bytes, metadata, context) {
      scans.push({ bytes, metadata, context });
      return { verdict: 'clean' };
    },
  });
  const validInput = { filename: 'fixture.png', mime_type: 'image/png', content_base64: Buffer.from(pngBytes()).toString('base64') };
  await cleanPolicy.validate(aliceContext, validInput);
  assert.equal(scans.length, 1);
  assert.equal(scans[0].context.subject, 'user-alice');
  await rejectsCode(() => cleanPolicy.validate(aliceContext, { ...validInput, content_base64: 'not-base64' }), 'INVALID_INPUT');
  await rejectsCode(() => cleanPolicy.validate(aliceContext, { ...validInput, content_base64: Buffer.from(pngBytes(40)).toString('base64') }), 'PAYLOAD_TOO_LARGE');
  assert.equal(scans.length, 1);

  for (const verdict of ['malicious', 'unknown']) {
    const policy = new UploadValidationPolicy(mediaConfig, { async scan() { return { verdict }; } });
    await rejectsCode(() => policy.validate(aliceContext, validInput), 'INVALID_INPUT');
  }
});

test('SEV-1 URL and SSRF controls reject unsafe schemes, credentials, ports, hosts, private DNS, and rebinding mixtures', async () => {
  throwsCode(() => parseRemoteUrl('http://media.varoriya.com/input.png', urlConfig), 'UNSAFE_URL');
  throwsCode(() => parseRemoteUrl('https://user:pass@media.varoriya.com/input.png', urlConfig), 'UNSAFE_URL');
  throwsCode(() => parseRemoteUrl('https://evil.example/input.png', urlConfig), 'UNSAFE_URL');
  throwsCode(() => parseRemoteUrl('https://media.varoriya.com:8443/input.png', urlConfig), 'UNSAFE_URL');
  assert.equal(isBlockedIpAddress('127.0.0.1', 4), true);
  assert.equal(isBlockedIpAddress('169.254.169.254', 4), true);
  assert.equal(isBlockedIpAddress('93.184.216.34', 4), false);

  const safe = new SsrfGuard(urlConfig, { async resolveAll() { return [{ address: '93.184.216.34', family: 4 }]; } });
  const target = await safe.validate('https://media.varoriya.com/input.png');
  assert.equal(target.resolvedAddresses[0].address, '93.184.216.34');
  const privateDns = new SsrfGuard(urlConfig, { async resolveAll() { return [{ address: '10.0.0.5', family: 4 }]; } });
  await rejectsCode(() => privateDns.validate('https://media.varoriya.com/input.png'), 'UNSAFE_URL');
  const rebinding = new SsrfGuard(urlConfig, { async resolveAll() { return [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]; } });
  await rejectsCode(() => rebinding.validate('https://media.varoriya.com/input.png'), 'UNSAFE_URL');
});

test('SEV-1 redaction removes bearer, token, prompt, media, and signed URL/query secrets', () => {
  const headers = redactHeaders({ authorization: 'Bearer fixture-token-alice', cookie: 'session=fixture', 'x-request-id': 'request-fixture-001' });
  assert.equal(headers.authorization, '[REDACTED]');
  assert.equal(headers.cookie, '[REDACTED]');
  assert.equal(headers['x-request-id'], 'request-fixture-001');
  const redacted = redactLogValue({
    quote_token: 'quote-token-fixture-image-001',
    prompt: 'private prompt',
    media_bytes: 'private media',
    result: 'https://results.varoriya.com/result?signed=fixture-secret',
  });
  const serialized = JSON.stringify(redacted);
  for (const secret of ['quote-token-fixture-image-001', 'private prompt', 'private media', 'fixture-secret']) {
    assert.equal(serialized.includes(secret), false);
  }
  const safeUrl = redactUrl('https://results.varoriya.com/result?token=fixture-secret#fragment');
  assert.equal(safeUrl.includes('fixture-secret'), false);
  assert.equal(safeUrl.startsWith('https://results.varoriya.com/result?'), true);
});
