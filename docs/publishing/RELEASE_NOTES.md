# Release notes — 0.2.0 release candidate

Date: 2026-09-13

## Added

- Eight MCP tools with titles, closed input/output schemas, and explicit read-only/destructive/open-world annotations.
- OAuth protected-resource metadata and fail-closed production configuration.
- PostgreSQL-backed ownership, quote digest, per-generation cost reservation, and request-fingerprinted fenced idempotency adapters with migrations and cleanup SQL.
- ClamAV INSTREAM upload scanning with required production readiness checks.
- Structured redacted logs, bounded labels/metrics, request correlation, liveness/readiness endpoints, and bounded shutdown.
- Six positive and five negative release-harness cases in addition to functional/security tests.
- English/Thai end-user and administrator guides, submission materials, release checklist, and operations runbook.

## Security behavior

- Protected tools require exact OAuth scope and account-bound ownership.
- Charged generation requires a live subject/model/kind/parameter/cost/expiry-bound quote, explicit confirmation, cost reservation, and subject-scoped idempotency.
- Provider/database/scanner failures fail closed without leaking raw errors or secrets.
- Quote tokens are stored only as SHA-256 digests.

## Known external gates

This candidate is not published. Production HTTPS hosting, Varoriya sandbox/OAuth contract validation, verified publisher identity/domain, legal/support/logo assets, reviewer access, manual interoperability tests, independent release approval, and the final portal publish action remain human/external gates.

## Upgrade notes

Production now requires `DATABASE_URL`, `CLAMAV_HOST`, and a non-empty `VARORIYA_MODEL_POLICIES_JSON`. Apply migration `001_production_security.up.sql` before rollout. Do not set `VARORIYA_API_KEY` in production OAuth mode.
