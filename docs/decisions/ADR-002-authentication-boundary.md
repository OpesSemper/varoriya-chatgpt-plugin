# ADR-002: OAuth-first authentication boundary

- Status: Accepted with production gates
- Severity: SEV-0
- Owner: SA-SEC (model `gpt-5.6-sol`, effort `xhigh`)

## Decision

Use OAuth bearer tokens for production. Validate signature, issuer, audience, algorithm, time claims, scopes, and a stable resource-owner claim before protected tools run. Publish OAuth protected-resource metadata for the MCP resource.

A separate API-key mode exists only for local development. Startup rejects that mode in production. Credentials and signed result URLs must not be logged.

## Production gates

- Confirm the OAuth issuer, JWKS URI, audience, resource parameter, PKCE/client-registration behavior, and key-rotation policy.
- Confirm whether the resulting OAuth access token is accepted by Varoriya REST endpoints. Do not substitute a shared production API key for user-scoped access.
- Provide durable ownership, quote, cost, and idempotency stores plus a real malware scanner.
- Complete independent authorization-negative and cross-account tests before release.
