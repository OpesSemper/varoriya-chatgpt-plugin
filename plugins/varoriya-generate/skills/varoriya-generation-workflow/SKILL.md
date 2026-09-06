---
name: varoriya-generation-workflow
description: Run safe Varoriya image, video, and audio generation with model discovery, live quotes, explicit confirmation, polling, expiry-aware delivery, and recoverable failures.
---

# Varoriya generation workflow

Use this skill when the user asks to generate an image, video, or audio asset with Varoriya, compare available generation models, check a generation job, or retrieve a completed result.

## Operating rules

- Treat generation as a credit-consuming external side effect.
- Do not claim a model, price, duration, resolution, or output format is available unless `list_models` returns it for the current account and request.
- Do not call a `generate_*` tool before the user has seen a current quote and explicitly confirmed the exact request, model, parameters, and price.
- Use the user’s own request data only for the current job. Do not expose prompts, media, tokens, provider credentials, or complete signed URLs in chat or logs.
- Keep the stable `request_id` and `job_id` for follow-up calls. Never ask the user to copy a provider credential or an internal token.
- If the production MCP connection, OAuth scope, or account identity is unavailable, stop at the safe boundary and explain what connection or permission is missing.

## Workflow

### 1. Normalize the request

Identify:

- media type: image, video, or audio;
- intended output and prompt;
- input media or reference requirements;
- model preferences, if any;
- dimensions, duration, quality, format, count, and other supported parameters;
- delivery expectation and whether the user wants one result or multiple variants.

If a required value is missing and materially changes price or feasibility, ask one focused question before calling a tool. Do not invent defaults that change the quoted result.

### 2. Select a supported model

Call `list_models` with the media type and relevant capability filters. Present a compact comparison using only returned fields:

- model identifier and supported media type;
- capability and parameter limits;
- estimated or catalog price information, clearly marked as non-final when it is not a quote;
- expected processing characteristics when returned.

Recommend a model using the user’s stated priority, such as quality, speed, resolution, duration, or cost. If no returned model satisfies the request, explain the constraint and offer the closest supported option without silently changing the request.

### 3. Obtain a live quote

Call `quote_generation` using the selected model and the exact generation parameters. Treat the response as authoritative only for its validity window.

Show the user:

- media type and model;
- material parameters and quantity;
- quoted credit amount and currency/unit;
- quote expiry time or remaining validity;
- whether upload, storage, or other charges are included;
- the next action: confirmation or revision.

Do not generate from a stale, missing, malformed, user-mismatched, or expired quote. If the quote changes after a revision, obtain a new quote.

### 4. Obtain explicit confirmation

Ask for an unambiguous confirmation immediately before the side effect. Confirmation must identify the quoted request and price, for example: “Confirm generation of one 1024px image with model X for 12 credits.”

Do not treat these as confirmation:

- “sounds good” before a quote is shown;
- a request to compare models;
- a request to prepare or preview parameters;
- silence, a timeout, or a previous confirmation for a different quote;
- a confirmation after the quote expiry time.

If the user changes any material parameter, cancel the pending flow and return to model selection or quoting.

### 5. Generate with idempotency

After confirmation, call exactly one matching `generate_image`, `generate_video`, or `generate_audio` tool with:

- the accepted quote token;
- the confirmed parameters;
- a fresh client idempotency key for this intended attempt;
- the required confirmation signal, if the contract exposes one.

If the call times out after submission, do not retry with a new idempotency key immediately. Use the original `request_id` or idempotency key to reconcile the job. A repeated key must not create another charge or job.

Report the returned `job_id`, initial status, quoted/final cost fields, and the next polling action. Do not report success until the service returns a completed state.

### 6. Poll safely

Call `get_job` using the `job_id` and the user-bound read scope. Use the service’s retry or polling guidance when available; otherwise use bounded backoff and stop after a reasonable number of attempts for the interaction.

Recognize at least these states:

- `queued` or `processing`: tell the user the job is still running and continue bounded polling when appropriate;
- `completed`: deliver the result metadata and expiring link;
- `failed`: show the safe error, whether retry is recoverable, and the next action;
- `cancelled` or `expired`: explain that the result is no longer available and whether a new request is required.

Never poll indefinitely, create a new job merely because progress is slow, or expose provider-internal status details that are not part of the public contract.

### 7. Deliver and handle expiry

For a completed job, provide the result type, format, dimensions or duration when returned, and the signed result URL with its expiry. Tell the user to download or save it before expiry if the delivery link is temporary.

If the link has expired, call `get_job` once to request the contract-supported refresh or replacement. If refresh is unavailable, explain that the artifact must be regenerated and return to the quote-and-confirm flow. Never reconstruct or alter signed URLs locally.

### 8. Safe failures

Map errors to the stable public error code and a user action:

| Error | Safe response | Next action |
|---|---|---|
| `AUTH_REQUIRED` or `INSUFFICIENT_SCOPE` | Connection or permission is missing | connect the account or request the required scope |
| `INVALID_INPUT` or `UNSUPPORTED_MODEL` | Request cannot be accepted as specified | revise the affected parameter or model |
| `INVALID_QUOTE`, `PRICE_CHANGED`, or expired quote | Quote is no longer usable | re-quote and reconfirm |
| `INSUFFICIENT_BALANCE` | Account cannot fund the confirmed request | add credit or choose a lower-cost request |
| `RATE_LIMITED` | Service is temporarily throttling requests | wait and retry the same safe read or reconcile the existing job |
| `PROVIDER_UNAVAILABLE` | Provider did not accept or finish the job | reconcile the existing job before considering a new request |
| `RESOURCE_FORBIDDEN` or `JOB_NOT_FOUND` | The job is not accessible to this account | verify account and job identifier without exposing another user’s data |

For any unknown error, preserve the `request_id`, state that the result is unverified, and stop before creating another charge. Do not disclose stack traces, credentials, raw provider responses, or internal infrastructure names.

## Completion checklist

- The model came from the current `list_models` response.
- The quote matched the final material parameters and was valid at confirmation.
- The user explicitly confirmed the exact quoted charge.
- Generation used idempotency and the correct user-bound scope.
- Polling ended in a known terminal state or a clearly bounded in-progress state.
- Delivery included expiry information without exposing secrets.
- Any retry preserved charge safety and reconciled the original request first.
