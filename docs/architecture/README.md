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

- [ADR-001](../decisions/ADR-001-mcp-gateway.md): production MCP origin and integration boundaries
- [ADR-002](../decisions/ADR-002-authentication-boundary.md): OAuth issuer, client identification, PKCE, audience, scopes, and token lifecycle
- [ADR-003](../decisions/ADR-003-quote-cost-idempotency.md): quote token, per-generation cost reservation, and request-fingerprinted idempotency ledger
- [ADR-004](../decisions/ADR-004-upload-security.md): upload limits, malware scanning, and SSRF defense
- [ADR-005](../decisions/ADR-005-observability.md): logs, metrics, readiness, retention, and redaction
- [ADR-006](../decisions/ADR-006-provider-contract.md): provider abstraction, pricing reconciliation, and failure semantics

The current threat analysis is [THREAT_MODEL.md](../security/THREAT_MODEL.md).

Every ADR must record context, decision, alternatives, security/privacy consequences, migration/rollback, approvers, and linked requirements/tests.

## Release invariants

- A write tool cannot run without a valid user confirmation and unexpired signed quote.
- A repeated idempotency key cannot create a second charge or generation job.
- Every resource read or write validates OAuth subject-to-resource ownership.
- Secrets, raw prompts, user media, and complete signed URLs are excluded from telemetry.
- Public tool schemas remain backward compatible or undergo a versioned review.
