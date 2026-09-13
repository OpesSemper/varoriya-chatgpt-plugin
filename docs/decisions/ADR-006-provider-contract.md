# ADR-006: Varoriya provider contract and failure semantics

- Status: Proposed pending Varoriya sandbox confirmation
- Severity: SEV-0
- Owners: Solution Architect, Backend Lead, Varoriya integration owner
- Sub-Agent assignment: SA-ARCH (`gpt-5.6-sol`, xhigh)

## Proposed contract

The gateway uses a narrow typed REST adapter for pricing/model discovery, quote, account balance, file upload, generation, and job retrieval. It forwards the user OAuth bearer only on protected calls, never retries provider requests internally, propagates an opaque request ID, adds the idempotency key to generation, maps provider failures to stable public codes, and accepts only validated success envelopes and HTTPS result URLs.

The assumed paths and response fields in `server/src/varoriya-api/client.ts` are not authoritative until verified against a Varoriya-controlled sandbox. Production must not silently replace user-scoped OAuth with a shared provider API key.

## Required validation

- OAuth issuer/audience/JWKS and whether the access token is accepted by REST.
- Exact paths, methods, schemas, MIME/upload mechanism, model IDs, quote authenticity/expiry, currencies/precision, idempotency behavior, job states, result URL TTL/refresh, rate limits, and error envelopes.
- Reconciliation after timeout and proof that repeated generation keys do not duplicate charge/job.
- Brand/domain/data-processing authorization.

## Migration and rollback

Adapt only the provider client and contract fixtures when the verified API differs; preserve public MCP schemas or version them through change control. A contract mismatch, price mismatch, or ambiguous charge blocks release and freezes generation until reconciled.
