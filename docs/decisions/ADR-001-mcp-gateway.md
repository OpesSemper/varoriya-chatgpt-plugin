# ADR-001: Dedicated stateless MCP gateway

- Status: Accepted for implementation baseline
- Severity: SEV-1
- Owners: SA-BE (backend), SA-SEC (security), Main Agent (integration)

## Decision

Expose a dedicated TypeScript MCP gateway over Streamable HTTP at `/mcp`. The gateway publishes eight focused tools and calls the Varoriya REST API through a typed adapter. Each request receives a new MCP server/transport instance, while durable production state is delegated to explicit stores.

The tools are `list_models`, `quote_generation`, `get_balance`, `upload_input`, `generate_image`, `generate_video`, `generate_audio`, and `get_job`.

## Rationale

The boundary keeps tool schemas, authentication, authorization, cost controls, ownership checks, idempotency, and safe error translation under project control. Model names, prices, and limits are read live rather than embedded in the plugin.

## Consequences

- A public HTTPS `/mcp` endpoint is required before ChatGPT connection or directory submission.
- Generation writes are never retried blindly.
- Production requires shared atomic stores; in-memory adapters are limited to development and tests.
- The Varoriya REST request/response contract must be verified against a sandbox before release.
