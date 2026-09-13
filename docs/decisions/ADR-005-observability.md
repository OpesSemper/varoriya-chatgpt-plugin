# ADR-005: Privacy-preserving operations telemetry

- Status: Accepted for release candidate; platform exporter/alerts pending
- Severity: SEV-1
- Owners: DevOps/SRE and Security Leads
- Sub-Agent assignment: SA-OPS (`gpt-5.6-terra`, high)

## Decision

Emit structured JSON logs with opaque request correlation and final-boundary recursive redaction. Protect service, environment, timestamp, level, event, and correlation fields from caller overwrite. Emit metrics with fixed low-cardinality labels only. Expose shallow liveness and dependency-backed readiness; production readiness requires the PostgreSQL schema and ClamAV. Bound graceful shutdown by configuration.

Never log or label OAuth/API credentials, subjects, prompts, media, quote/idempotency values, provider IDs, raw errors, or complete signed URLs.

## Consequences

The bundled sink writes metric events to the JSON stream. The hosting platform must collect/route them or provide an approved exporter, define retention/access, validate alerts, and correlate by request/deployment revision without customer content.

## Rollback and verification

Telemetry failure must not expose data or make a security dependency appear ready. Rollback/freeze triggers are defined in `docs/runbooks/production-operations.md`. Automated evidence is in `operations-readiness.test.mjs` and gateway transport tests.
