# SEV-1 QA verification and evidence plan

## Scope

This suite tests the TypeScript MCP server's production modules directly under `server/src/**`. It uses Node's built-in test runner with `tsx`, deterministic in-process fixtures, fake provider/DNS/database adapters, and a loopback ClamAV protocol fixture. It performs no real Varoriya request, paid generation, production credential use, external media upload, external DNS lookup, or non-loopback network access.

The release-candidate verification covers source, migrations, tests, plugin metadata, publication material, and validation scripts.

## Required command

Run from `server/`:

```bash
npm test
```

The tests import `.ts` modules from `server/src` directly. There is no skip-on-missing path: a missing module/export, changed contract, or failed control is a hard test failure.

## Current local verification

- Node version: `v24.19.0`.
- `npm run typecheck`: passed.
- `npm test`: 49 passed, 0 failed, 0 skipped, 0 cancelled, 0 unfinished.
- `npm run build`: passed.
- `npm audit --audit-level=high`: 0 known vulnerabilities in the locked dependency graph at execution time.
- Plugin package and structural release validators: passed; strict publication preflight remains blocked only by publisher-owned required inputs.

These are local candidate results dated 2026-09-13. The PR commit SHA and GitHub Actions run must be linked before treating them as immutable release evidence.

## Coverage and release evidence

| Evidence ID | Test file | Control | Required result |
|---|---|---|---|
| QA-SEV1-001 | `auth-policy.test.mjs` | Bearer fail-closed parsing | Missing, folded, malformed, and control-character credentials rejected |
| QA-SEV1-002 | `auth-policy.test.mjs` | OAuth/JWT boundary | Issuer, audience, algorithm, time, subject, and scope syntax enforced |
| QA-SEV1-003 | `auth-policy.test.mjs` | Scope and ownership | Exact scopes and trusted resource owner required; default deny |
| QA-SEV1-004 | `generation-idempotency.test.mjs` | Quote binding/expiry | Token verification result bound to subject, model, kind, canonical parameters, price ceiling, and expiry |
| QA-SEV1-005 | `generation-idempotency.test.mjs` | Confirmation | `confirm !== true` rejected before guard/provider invocation |
| QA-SEV1-006 | `generation-idempotency.test.mjs` | Idempotency | Completed replay returns same job and performs one provider POST |
| QA-SEV1-007 | `generation-idempotency.test.mjs` | Production-safe stores | In-memory idempotency/ownership stores forbidden in production |
| QA-SEV1-008 | `upload-ssrf-redaction.test.mjs` | MIME and size | Magic MIME, extension, encoding, and upload size boundaries enforced |
| QA-SEV1-009 | `upload-ssrf-redaction.test.mjs` | Malware fail-closed | Scanner runs after validation; malicious/unknown verdict rejected |
| QA-SEV1-010 | `upload-ssrf-redaction.test.mjs` | URL/SSRF | Scheme, credentials, host, port, private/link-local IP, DNS and rebinding controls enforced |
| QA-SEV1-011 | `upload-ssrf-redaction.test.mjs` | Redaction | Credentials, quote token, prompt, media, signed query/fragment removed |
| QA-SEV1-012 | `provider-client.test.mjs` | Provider success envelope | Job envelope parsed; request, bearer, and idempotency headers preserved |
| QA-SEV1-013 | `provider-client.test.mjs` | Provider error mapping | HTTP/error envelopes map to stable safe codes and recoverability |
| QA-SEV1-014 | `provider-client.test.mjs` | Unexpected provider response | Malformed success fails closed as `PROVIDER_UNAVAILABLE` |
| QA-SEV1-015 | `tool-contracts-order.test.mjs` | Tool registry and annotations | Exactly eight tools; closed schemas; read/write safety annotations correct |
| QA-SEV1-016 | `tool-contracts-order.test.mjs` | Tool selection/runtime schema | Explicit media maps to exact tool; unknown/invalid input fails closed |
| QA-SEV1-017 | `tool-contracts-order.test.mjs` | Ownership invocation order | Scope → ownership → provider read; denial stops downstream calls |
| QA-SEV1-018 | `tool-contracts-order.test.mjs` | Charged-generation order | File ownership precedes idempotency reservation and provider submission |
| QA-SEV1-019 | `gateway-transport.test.mjs` | Streamable HTTP transport | Health, method rejection, initialize, tools/list, and public tool call pass on an ephemeral local server |
| QA-SEV1-020 | `gateway-transport.test.mjs` | HTTP authentication boundary | Protected calls require authentication before provider access; development credentials and adapters fail closed in production |
| QA-SEV1-021 | `gateway-transport.test.mjs` | MCP body boundary | JSON body limit matches upload contract; oversized/malformed bodies receive safe JSON-RPC errors |
| QA-SEV1-022 | `operations-readiness.test.mjs` | Logging, metrics, readiness | Correlation/redaction, bounded labels, required dependency failures and timeout behavior pass |
| QA-SEV1-023 | `production-security.test.mjs` | PostgreSQL durable controls | Ownership, quote/cost reservation, idempotency fingerprint, zero-cost quote, parameterization, and fail-closed behavior pass |
| QA-SEV1-024 | `production-security.test.mjs` | ClamAV and migrations | INSTREAM/PING framing, verdict handling, token digest schema, cleanup targets, and request fingerprint pass |
| QA-SEV1-025 | `release-submission.test.mjs` | Reviewer harness | Six positive and five negative no-credit cases pass |

## Acceptance criteria

- Zero failures, zero skips, and zero unfinished cases.
- No external network requests or paid generation.
- Repeating one subject/idempotency key creates no second provider POST.
- Authorization failure invokes neither ownership data access nor provider access.
- Provider details, bearer values, quote tokens, prompts, media, and signed URL secrets are absent from public errors/log payloads.
- Test output, Node version, exact commit SHA, fixture hashes, and review approval are retained as immutable CI evidence.

## Evidence ownership

The QA Lead owns execution evidence. The Security Lead reviews authentication, authorization, ownership, SSRF, and redaction results. The Backend Lead resolves implementation failures. The Release Manager confirms zero skipped/failed SEV-1 cases before release. Sub-agents cannot accept residual risk or approve production/publication.
