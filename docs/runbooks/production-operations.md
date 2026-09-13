# Production operations runbook

This runbook defines the operational requirements for the Varoriya MCP gateway. It is a pre-production guide: no production deployment, backup/restore, failover, alert exercise, or paid Varoriya API call has been performed as part of this repository baseline.

## Scope and ownership

The service owner approves deployment and rollback. The security owner approves threat-model changes, data retention, incident disclosure, and exceptions. The platform owner owns ingress, secrets, monitoring, backup systems, and workload identity. A human release manager approves directory submission. No automated agent may approve a release, spend, or risk acceptance.

## Implemented operational wiring

The composition root now creates a JSON logger, low-cardinality metrics sink, request correlation, PostgreSQL and ClamAV adapters, and a health registry. It exposes `/livez` and `/readyz`, checks the durable schema and scanner in production, and performs bounded shutdown using `SHUTDOWN_TIMEOUT_MS`.

The built-in metrics sink emits structured metric events to the redacted JSON logger. A production platform must collect these events or replace the sink with an approved metrics exporter while preserving the fixed label allowlist. Provider/cost/idempotency telemetry coverage and platform alert validation remain release evidence gates.

The `/healthz` route is shallow compatibility only. Production ingress must use `/readyz`. Do not silently substitute development security adapters: production configuration requires PostgreSQL, ClamAV, OAuth/HTTPS metadata, and a non-empty model policy and fails startup otherwise.

## Logging, metrics, and data handling

`createJsonLogger` uses existing recursive redaction as a final safety boundary; strict allowlisting remains mandatory. Retain logs for the approved minimum period only, with restricted access and audit trails. Rotate platform encryption keys and service secrets according to the approved security policy. Never export raw prompts or media to observability tooling.

Required metrics are `varoriya_gateway_requests_total`, request/provider duration, auth outcomes, tool outcomes, provider outcomes, cost decisions, idempotency outcomes, and readiness state. Labels are intentionally restricted to route, status class, auth mode, tool, operation, outcome, decision, and dependency. Do not label by request, user, token, file, quote, provider job, URL, or error message.

## SLOs and alert policy

Proposed initial objectives, subject to service-owner approval after baseline measurement:

| Indicator | Objective | Paging trigger |
| --- | --- | --- |
| Valid authenticated MCP request availability | 99.9% per rolling 30 days, excluding approved maintenance and upstream provider exclusions | 5xx rate > 5% for 10 min and confirmed client impact |
| Gateway latency | p95 < 1 s excluding generation/provider processing | p95 > 2 s for 15 min |
| Readiness | Required dependencies ready | Any production replica unready > 10 min; page if all replicas unready > 2 min |
| Security | Zero known secret leakage and zero bypass of quote/confirm/idempotency controls | Immediate page on suspected secret leak or control bypass |
| Cost/idempotency | No duplicate charge caused by gateway retry | Immediate page on suspected duplicate charge; freeze generation if confirmed |

Alerts must link to a runbook, request correlation IDs (not customer content), current deployment revision, owner, and escalation policy. Configure warning alerts for provider degradation and capacity trends; page only for actionable, user-impacting conditions. Validate alert routing in a non-production exercise before production use.

## Deployment checklist

1. Verify CI, independent SEV-0 review, approved threat model, and all release evidence.
2. Confirm an approved public HTTPS origin, DNS, TLS certificate, OAuth issuer/JWKS/audience, and exact Varoriya sandbox request/response contract.
3. Provision secrets through a managed secret system with least-privilege workload identity. Do not place secrets in compose files, images, source control, shell history, or logs.
4. Configure a minimum of two replicas across failure domains where the platform supports it, private container networking, TLS ingress, egress allowlisting, WAF/rate limits, and network policies. Because idempotency is durable in PostgreSQL, replicas may share the same database; validate contention and failover before scale-out. The provider egress allowlist must be revalidated against current provider documentation.
5. Apply the hardening in `deploy/docker-compose.production.example.yml`: non-root user, read-only root filesystem, dropped capabilities, no-new-privileges, PID/memory/CPU limits, and a bounded writable `/tmp`. Use immutable image digests in the approved deployment system.
6. Inject approved production settings and secrets, then verify `/livez`, `/readyz`, OAuth metadata, MCP discovery, protected-tool 401 behavior, and a no-charge smoke path. Do not generate paid media until the billing owner approves a controlled test.
7. Record deployment revision, approvers, change ticket, artifact digest, configuration version (not values), and smoke-test evidence.

## Smoke test procedure

Run in sandbox or a pre-approved non-billable environment first. Record only redacted evidence.

1. `GET /livez` must return 200.
2. `GET /readyz` must return 200 only when every required production dependency is healthy.
3. `GET /.well-known/oauth-protected-resource/mcp` must expose the approved resource metadata.
4. `tools/list` and public `list_models` must work without a credential.
5. A protected tool without a token must return 401 and the expected OAuth `WWW-Authenticate` metadata without leaking internals.
6. With an approved sandbox token, validate one no-charge or provider-stubbed quote, parameter binding rejection, idempotency replay, ownership denial, and provider timeout. Do not use prompts/media containing personal or sensitive information.
7. Confirm logs are correlated and redacted; confirm only bounded, allowed metric labels are emitted.

## Rollback and incident response

Rollback triggers include authentication bypass, secret exposure, unexpected charge, duplicate generation, ownership failure, elevated 5xx rate, readiness loss, or a high/critical vulnerability. The incident commander may freeze generation by removing the service from ingress or setting replicas to zero while preserving evidence. Do not delete logs or state during containment.

1. Declare severity, open an incident record, assign incident commander, communications lead, and technical lead.
2. Contain: disable public ingress or generation traffic, revoke exposed credentials, preserve deployment revision and redacted telemetry.
3. Roll back to the last approved immutable image/configuration pair. Never roll forward under active uncertainty without incident commander approval.
4. Verify liveness, readiness, protected-tool denial, and no-charge smoke checks. Keep generation disabled until security and billing owners approve restoration when a charge/control issue occurred.
5. Communicate factual status through the approved channel, complete root-cause analysis, corrective actions, and evidence retention within the organization’s incident policy.

## Backup, restore, and retention

The production durable store must support atomic ownership, quote, cost, and idempotency records. Back up encrypted data using a service identity scoped only to backup writes; separate backup administration from restore authority. Define retention by approved legal/privacy requirements; as a minimum, retain only metadata necessary for reconciliation, audit, and incident investigation, and never back up raw prompts/media unless explicitly approved.

Before launch, perform and document a non-production restore exercise: restore an encrypted point-in-time backup into an isolated environment, verify record integrity and access controls, run read-only reconciliation, then securely destroy the test restore. Define RPO/RTO from measured results; do not claim values before this exercise. Test deletion/expiry behavior and key-rotation recovery separately.

## Remaining production gates

- Provisioned PostgreSQL and ClamAV plus backup/restore, failover, and scanner exercises. The production adapters and readiness wiring exist, but no live platform evidence is claimed.
- Confirmed Varoriya OAuth-to-REST and sandbox contract validation.
- Public HTTPS ingress, egress controls, DNS/TLS, WAF/rate limits, and workload identity.
- Metrics exporter/collector, log retention controls, alert routing, and non-production alert exercise.
- Independent SEV-0 review, legal privacy/terms, billing authorization, and human directory-release approval.
