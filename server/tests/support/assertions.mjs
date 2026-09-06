import assert from 'node:assert/strict';

export async function rejectsCode(operation, expectedCode) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, expectedCode);
    assert.equal(typeof error?.message, 'string');
    assert.notEqual(error.message.trim(), '');
    return true;
  });
}

export function throwsCode(operation, expectedCode) {
  assert.throws(operation, (error) => {
    assert.equal(error?.code, expectedCode);
    assert.equal(typeof error?.message, 'string');
    return true;
  });
}

export function toolFailure(result, expectedCode) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, expectedCode);
  assert.equal(typeof result.request_id, 'string');
  assert.equal(typeof result.error.message, 'string');
  assert.equal(typeof result.error.recoverable, 'boolean');
}

export function jsonResponse(body, status = 200, requestId = 'provider-request-fixture-001') {
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
