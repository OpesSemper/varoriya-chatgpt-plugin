# Varoriya Gateway — Administrator and Developer Guide

Status: release-candidate operations guide. It does not authorize production deployment or ChatGPT directory publication.

## System boundary

The repository contains two related deliverables:

1. A public Streamable HTTP MCP gateway that validates identity, authorization, quote binding, cost, ownership, idempotency, uploads, and provider responses.
2. A Codex plugin package whose skill instructs the assistant to discover models, quote, obtain explicit confirmation, submit once, poll, and deliver expiring results safely.

ChatGPT directory publication reviews the deployed MCP server. The local Codex package is not a substitute for registering and reviewing the public MCP endpoint.

## Production prerequisites

- Node.js 24 and an immutable container image.
- A publisher-owned HTTPS origin dedicated to this gateway.
- An OAuth authorization server with public JWKS, exact audience validation, short-lived access tokens, and approved scopes.
- PostgreSQL with TLS, backups, point-in-time recovery, and least-privilege credentials.
- A reachable ClamAV daemon isolated from the public network.
- Approved Varoriya API/OAuth contract and model allowlist.
- Managed ingress, DNS/TLS, egress restrictions, WAF/rate limits, logs, metrics, alerts, and secret management.
- Publisher identity, domain, privacy policy, terms, support URL, logo, reviewer account, and publication authority.

## Build and verify

```bash
cd server
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
cd ..
node scripts/validate-plugin.mjs
node scripts/release/validate-submission.mjs
```

The final command must fail while publisher-owned values remain unresolved. That failure is a release guard, not a reason to replace legal or operational values with invented content.

## Database setup

Apply `server/migrations/001_production_security.up.sql` through the approved migration system before starting an application replica. The runtime identity needs only the DML and read privileges required for the `varoriya_security` schema; it should not own the database or migration role.

The schema persists:

- immutable file/job ownership bindings;
- fixed-window cost reservations;
- SHA-256 quote-token digests and immutable quote claims;
- fenced idempotency leases and completed job records.

Schedule `server/migrations/cleanup.sql` only after legal, reconciliation, incident, and restore requirements define retention. Test the down migration only in an isolated disposable environment.

## Runtime configuration

Copy `server/.env.example` only as a field reference. Never commit the resulting environment file. In production, the process rejects missing HTTPS/OAuth metadata, PostgreSQL, ClamAV, or an empty model policy.

Required production classes:

| Class | Variables |
|---|---|
| Public service | `NODE_ENV`, `HOST`, `PORT`, `PUBLIC_ORIGIN` |
| OAuth | `VARORIYA_AUTH_MODE=oauth`, issuer, audiences, JWKS URI, algorithms, owner claim |
| Provider | `VARORIYA_API_BASE_URL`, timeout; no static `VARORIYA_API_KEY` in production OAuth mode |
| Durable controls | `DATABASE_URL`, pool and statement timeouts |
| Upload safety | `CLAMAV_HOST`, port, timeout, MIME and byte limits |
| Billing safety | cost currency, request/window limits, window duration |
| Authorization | `VARORIYA_MODEL_POLICIES_JSON` exact model/kind/scope/parameter allowlist |
| Operations | health and shutdown timeouts |

Keep `VARORIYA_REMOTE_URLS_ENABLED=false` unless security explicitly approves remote fetches and exact destination hosts. Uploaded bytes are validated for MIME, size, filename, and malware before provider upload.

The JSON upload contract is capped at 10 MiB of decoded media. Larger media requires a separately reviewed presigned/streaming upload design; do not raise the JSON body limit independently of the tool schema and validation policy.

## Model-policy example

```json
[
  {
    "model": "publisher-approved-image-model",
    "kinds": ["image"],
    "requiredScopes": ["generation:create"],
    "allowedParameterKeys": ["height", "width", "quality"]
  }
]
```

Use only identifiers and parameters returned and approved by the current Varoriya contract. Duplicate model/kind entries are rejected because overlapping rules could weaken authorization. Public discovery may list entries without a `subjects` restriction; protected quote/generate calls still enforce `requiredScopes`. Subject-restricted models are never exposed by public discovery.

## Start and health

```bash
cd server
npm run build
NODE_ENV=production node dist/src/index.js
```

- `GET /livez` confirms process liveness.
- `GET /readyz` checks required PostgreSQL schema and ClamAV readiness and returns 503 when either fails.
- `GET /healthz` is a shallow compatibility endpoint and must not be used to route production generation traffic.
- `POST /mcp` is the stateless Streamable HTTP endpoint.
- `GET /.well-known/oauth-protected-resource/mcp` publishes OAuth resource metadata.

Route production traffic only from `/readyz`. Shutdown is bounded by `SHUTDOWN_TIMEOUT_MS`.

## Security invariants

- Public discovery never forwards an incidental credential to Varoriya.
- Every protected call validates the OAuth issuer, audience, signature algorithm, time claims, subject, and exact scope.
- Quote claims are bound to subject, model, media kind, canonical parameters, price ceiling, and expiry.
- Charged generation requires `confirm=true` and a unique subject-scoped idempotency key.
- Provider writes occur only after ownership, quote, cost, and idempotency gates.
- Quote tokens are never persisted in plaintext; only their digest is stored.
- Database/scanner/provider failures deny the operation without exposing internals.
- Logs redact credentials, prompts, media, quote tokens, and signed URL secrets.

## Deploy, rollback, and evidence

Use `deploy/docker-compose.production.example.yml` as a reference, not a one-command production platform. Record image digest, source commit, migration version, configuration version, approvers, and redacted smoke evidence. Roll back or freeze generation on authorization bypass, ownership failure, duplicate charge, token leakage, readiness loss, or a high/critical vulnerability.

Follow [production operations](../runbooks/production-operations.md), [release checklist](../quality/release-checklist.md), and [submission guide](../publishing/SUBMISSION_GUIDE.md). Reviewer credentials must be delivered through the submission portal or another approved secret channel, never GitHub.

## Support and incident ownership

Public support URL/email: `[REQUIRED INPUT: publisher support contact]`

Security incident contact: `[REQUIRED INPUT: publisher security contact]`

Operations escalation/SLA: `[REQUIRED INPUT: publisher operations policy]`
