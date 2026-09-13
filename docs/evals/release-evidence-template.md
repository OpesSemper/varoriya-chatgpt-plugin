# Release evidence record

This is a controlled template. Replace only the reviewer fields during an approved release run. Do not paste bearer tokens, API keys, quote tokens, raw prompts, user media, complete signed URLs, or unredacted provider responses.

## Run identity

| Field | Reviewer value |
|---|---|
| Release version | `<release-version>` |
| Repository commit SHA | `<commit-sha>` |
| Run timestamp UTC | `<timestamp-utc>` |
| Environment class | `<local-fixture-or-approved-sandbox>` |
| Reviewer | `<reviewer-identity>` |
| Approval reference | `<change-or-release-reference>` |

## Automated evidence

| Command | Exit code | Result | Sanitized artifact/reference |
|---|---:|---|---|
| `cd server && npm run typecheck` | `<code>` | `<PASS/FAIL>` | `<reference>` |
| `cd server && npm test` | `<code>` | `<PASS/FAIL>` | `<reference>` |
| `cd server && npm run build` | `<code>` | `<PASS/FAIL>` | `<reference>` |
| `node server/tests/release-submission.test.mjs` | `<code>` | `<PASS/FAIL>` | `<reference>` |
| `node scripts/release/validate-submission.mjs` | `<code>` | `<PASS/FAIL>` | `<reference>` |
| `node scripts/validate-plugin.mjs` | `<code>` | `<PASS/FAIL>` | `<reference>` |
| `cd server && npm audit --audit-level=high` | `<code>` | `<PASS/FAIL>` | `<reference>` |

## Case results

| Case ID | Result | Evidence reference | Notes / defect ID |
|---|---|---|---|
| RELEASE-POS-001 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-POS-002 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-POS-003 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-POS-004 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-POS-005 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-POS-006 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-NEG-001 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-NEG-002 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-NEG-003 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-NEG-004 | `<PASS/FAIL>` | `<reference>` | `<notes>` |
| RELEASE-NEG-005 | `<PASS/FAIL>` | `<reference>` | `<notes>` |

## Manual and external gates

| Gate | Status before execution | Executed by | Evidence reference | Result |
|---|---|---|---|---|
| MCP Inspector interoperability | `PENDING_MANUAL_EXECUTION` | `<reviewer>` | `<reference>` | `<PASS/FAIL>` |
| API Playground protocol/schema | `PENDING_MANUAL_EXECUTION` | `<reviewer>` | `<reference>` | `<PASS/FAIL>` |
| ChatGPT developer-mode connection | `PENDING_MANUAL_EXECUTION` | `<reviewer>` | `<reference>` | `<PASS/FAIL>` |
| Varoriya OAuth-to-REST sandbox | `PENDING_EXTERNAL_VALIDATION` | `<provider-reviewer>` | `<reference>` | `<PASS/FAIL>` |
| Security/privacy/terms approval | `PENDING_HUMAN_APPROVAL` | `<authorized-owner>` | `<reference>` | `<PASS/FAIL>` |

## Defects and decision

- Open SEV-0 defects: `<none-or-issue-links>`
- Open SEV-1 defects: `<none-or-issue-links>`
- Risk acceptance reference: `<reference-or-not-applicable>`
- Rollback reference: `<reference>`
- Directory submission decision: `<APPROVE/BLOCK>`
- Decision rationale: `<sanitized-rationale>`
