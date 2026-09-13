# ADR-003: Quote, cost, and idempotency ledger

- Status: Accepted for release candidate; live reconciliation pending
- Severity: SEV-0
- Owners: Backend/Finance and Security Leads
- Sub-Agent assignment: SA-SEC (`gpt-5.6-sol`, xhigh), completed/integrated by Main Agent

## Context

Generation can consume credit. Retries, concurrent requests, expired quotes, cross-account tokens, and a reused idempotency key can create duplicate work or bypass local spending limits.

## Decision

- Record only a SHA-256 quote-token digest plus immutable subject/model/kind/parameters/cost/expiry claims.
- Require explicit `confirm=true` before any guard/provider write.
- Derive a 43-character HMAC-SHA-256 request fingerprint using the high-entropy quote token as key and the canonical material request as input. Persist only the fingerprint.
- Bind `(subject, idempotency_key)` to that fingerprint and use a fenced lease. A different request using the same key fails with `INVALID_INPUT`; a completed identical request replays its stored job.
- Reserve each positive quoted cost under `(quote digest, idempotency key)` in a PostgreSQL fixed window. A retry with a different correlation ID does not consume twice. A different idempotency key consumes a separate reservation.
- Allow an authenticated, valid zero-cost quote without creating a cost row so approved no-credit review can run.
- Keep ambiguous provider failures reserved for reconciliation; release a lease only when provider submission definitely did not occur.

## Alternatives rejected

- Process-local maps: not atomic across replicas and lost on restart.
- Reservation by quote token alone: a quote reused with different idempotency keys could undercount intended spend.
- Persisting prompts or quote tokens for matching: increases disclosure impact.
- Blind automatic retries: can create duplicate charges/jobs.

## Consequences and rollback

PostgreSQL is a required production dependency. Expired quote/idempotency/cost metadata needs controlled retention and cleanup. Rollback must preserve ledger tables until billing reconciliation is complete. Any duplicate-charge or mismatched-replay signal freezes generation and triggers incident handling.

## Verification and approval

Automated evidence: `generation-idempotency.test.mjs` and `production-security.test.mjs`. Production approval still requires Varoriya sandbox reconciliation, backup/restore evidence, Security Lead review, billing-owner approval, and Release Manager sign-off.
