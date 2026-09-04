# Architecture baseline

## Trust boundaries

| Boundary | Inbound data | Required controls | Evidence |
|---|---|---|---|
| ChatGPT → MCP gateway | OAuth token, tool input | audience/scope validation, schema limits, rate limits | auth and contract tests |
| MCP gateway → Varoriya API | normalized request, request ID | least-privilege service identity, timeout/retry policy, redacted logs | integration tests and log review |
| Upload ingress | reference media or remote URL | ownership, MIME sniffing, size limits, malware scan, SSRF controls | malicious-fixture suite |
| Generation provider | prompts, media, model parameters | provider allowlist, data-minimization, cost cap, reconciliation | vendor review and billing tests |
| Result delivery | signed result URL | short TTL, owner binding, no secret logging | cross-account negative tests |

## Required architecture decisions

- ADR-001: production MCP origin and integration boundaries
- ADR-002: OAuth issuer, client identification, PKCE, audience, scopes, and token lifecycle
- ADR-003: quote token and idempotency ledger
- ADR-004: upload storage, retention, malware scanning, and SSRF defense
- ADR-005: logs, metrics, audit events, retention, and sensitive-data redaction
- ADR-006: provider abstraction, pricing reconciliation, and failure semantics

Every ADR must record context, decision, alternatives, security/privacy consequences, migration/rollback, approvers, and linked requirements/tests.

## Release invariants

- A write tool cannot run without a valid user confirmation and unexpired signed quote.
- A repeated idempotency key cannot create a second charge or generation job.
- Every resource read or write validates OAuth subject-to-resource ownership.
- Secrets, raw prompts, user media, and complete signed URLs are excluded from telemetry.
- Public tool schemas remain backward compatible or undergo a versioned review.
