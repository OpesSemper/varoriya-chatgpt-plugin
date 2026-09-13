# Submission test cases

These cases are reviewer-ready and map directly to `server/tests/release-submission.test.mjs`. Automated cases are no-credit local tests: they use fixture identities, loopback HTTP, local fake clients, and zero-cost credit values.

## Automated positive cases

| ID | Case | Expected result | Evidence source |
|---|---|---|---|
| RELEASE-POS-001 | Tool contract, closed schemas, required fields, and safety annotations | Exactly eight tools are exposed; schemas reject additional properties; read-only and destructive/open-world annotations are present | `release-submission.test.mjs` |
| RELEASE-POS-002 | Public MCP discovery and OAuth protected-resource metadata | Metadata is discoverable; initialize, tools/list, and list_models work; incidental bearer is not forwarded to the fake provider | `release-submission.test.mjs` |
| RELEASE-POS-003 | Quote-first explicit confirmation flow | A live fixture quote is followed by `confirm=true`; one zero-cost local generation job is returned | `release-submission.test.mjs` |
| RELEASE-POS-004 | Concurrent idempotency | Thirty-two identical local requests produce one provider submission, thirty-one in-progress responses, then a safe replay | `release-submission.test.mjs` |
| RELEASE-POS-005 | Resource ownership | The owner can read the fixture job and use the owned input file; ownership checks precede provider access | `release-submission.test.mjs` |
| RELEASE-POS-006 | Concurrent public load model | Sixty-four concurrent local catalog reads complete without external network or subject leakage | `release-submission.test.mjs` |

## Automated negative cases

| ID | Case | Expected result | Evidence source |
|---|---|---|---|
| RELEASE-NEG-001 | Protected call without credentials | HTTP 401, `WWW-Authenticate` resource metadata challenge, no provider call | `release-submission.test.mjs` |
| RELEASE-NEG-002 | `confirm=false` or unknown input field | `INVALID_INPUT`; no quote, idempotency, or provider write | `release-submission.test.mjs` |
| RELEASE-NEG-003 | Quote parameter/expiry mismatch or foreign job owner | `INVALID_QUOTE` or `RESOURCE_FORBIDDEN`; provider is not contacted | `release-submission.test.mjs` |
| RELEASE-NEG-004 | Redaction regression | Authorization, cookie, prompt, media, quote, and signed URL secrets are absent from log-safe output | `release-submission.test.mjs` |
| RELEASE-NEG-005 | Credential and credit safety | Local balance is zero and no credential is accepted from tool input | `release-submission.test.mjs` |

## Running the automated cases

```bash
node server/tests/release-submission.test.mjs
node scripts/release/validate-submission.mjs
```

The validator emits JSON and exits non-zero when required publish materials are missing, unresolved publish placeholders are found, high-confidence credential patterns are detected, or required JSON is invalid.

## Manual gates

The following procedures are intentionally `PENDING_MANUAL_EXECUTION`. They must not be represented as passed until a human reviewer executes them against an approved public HTTPS deployment and records sanitized evidence using [release-evidence-template.md](release-evidence-template.md).

### MCP Inspector

1. Use the approved public HTTPS `/mcp` endpoint and configured OAuth test client.
2. Connect with MCP Inspector using the endpoint and OAuth metadata; do not paste tokens into screenshots or repository files.
3. Capture sanitized evidence for initialize, tools/list, public list_models, protected-call 401 challenge, quote_generation, explicit confirmation, one sandbox generation, and get_job polling.
4. Confirm the tool annotations and JSON schemas shown by Inspector match `RELEASE-POS-001`.
5. Record endpoint class, commit SHA, Inspector version, timestamp, case IDs, and reviewer identity. Mark the gate passed only after the external provider sandbox result is independently confirmed.

Status: `PENDING_MANUAL_EXECUTION`.

### API Playground

1. Configure the Playground with the public HTTPS `/mcp` endpoint, MCP protocol version `2025-06-18`, and approved OAuth metadata.
2. Verify JSON-RPC initialize and tools/list responses, including exactly eight tool definitions.
3. Execute public list_models without a token and confirm the response contains only the public catalog.
4. Execute get_balance and quote_generation with an approved test identity; verify the 401 challenge, scope behavior, quote expiry, and safe error envelopes.
5. Execute generation only in the approved zero-credit sandbox after explicit user confirmation; capture the job ID and result expiry without copying signed URLs.

Status: `PENDING_MANUAL_EXECUTION`.

### ChatGPT developer mode

1. Use an approved ChatGPT developer-mode workspace and the public HTTPS MCP endpoint.
2. Confirm OAuth discovery, consent, scopes, and resource audience before enabling the connection.
3. Ask ChatGPT to list supported models, request a quote, show the quoted cost, and wait for explicit confirmation.
4. Confirm that a generation request is not made before confirmation, that a changed parameter causes a new quote, and that follow-up polling uses the returned job ID.
5. Run only an approved zero-credit sandbox scenario. Do not test against a production account, real media, or real credits.
6. Record sanitized conversation screenshots and structured response evidence. Redact tokens, prompts, media, signed URLs, and personal data.

Status: `PENDING_MANUAL_EXECUTION`.

## Release decision rule

Local automation is necessary but insufficient. Any open SEV-0 issue, failed manual gate, unverified Varoriya OAuth-to-REST contract, missing privacy/terms approval, or absent rollback evidence blocks directory publication.
