# MCP tool contract baseline

| Tool | Intent | Side effect | Scope | Critical acceptance |
|---|---|---:|---|---|
| `list_models` | Discover supported models and limits | No | Public discovery | only current, allowlisted capabilities are returned; no incidental bearer token is forwarded |
| `quote_generation` | Return live price and signed quote token | No | `generation:read` | token binds user, model, parameters, price, and expiry |
| `get_balance` | Read current user credit | No | `billing:read` | never exposes another account |
| `upload_input` | Store reference media | Yes | `files:write` | validates owner, MIME, size, malware, and SSRF policy |
| `generate_image` | Create a charged image job | Yes | `generation:create` | confirmation, quote, idempotency, and limits pass |
| `generate_video` | Create a charged video job | Yes | `generation:create` | confirmation, quote, idempotency, and limits pass |
| `generate_audio` | Create a charged audio job | Yes | `generation:create` | confirmation, quote, idempotency, and limits pass |
| `get_job` | Read job state and results | No | `generation:read` | ownership and signed-result TTL enforced |

`generate_*` tools use conservative metadata: `destructiveHint=true` because they consume credit, and `openWorldHint=true` because they write external state and may invoke an external generation provider.

## Common output fields

Every tool returns a stable `request_id`. Generation calls return `job_id`, `status`, `model`, quoted/final cost fields, result URLs, expiry, and an explicit next action. Errors use stable codes, a safe user message, and a recoverability flag.

## Required error cases

`INVALID_INPUT`, `AUTH_REQUIRED`, `INVALID_TOKEN`, `INSUFFICIENT_SCOPE`, `RESOURCE_FORBIDDEN`, `INVALID_QUOTE`, `PRICE_CHANGED`, `INSUFFICIENT_BALANCE`, `UNSUPPORTED_MODEL`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `JOB_NOT_FOUND`.

## Contract controls

- Inputs use explicit enums, ranges, sizes, and formats; unknown fields fail closed.
- Tool descriptions state when to use the tool and how it differs from neighboring tools.
- Read/write scopes are separated.
- Output identifiers support safe follow-up calls without exposing provider credentials.
- Published contract snapshots are regression-tested for backward compatibility.
