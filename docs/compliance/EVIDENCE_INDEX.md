# Evidence index

Create one row per reviewable artifact. Public links must contain only sanitized, non-sensitive evidence.

| Evidence ID | Requirement/control | Issue/PR/release | Source and version | Owner | Reviewer/approver | Date | Integrity reference | Status |
|---|---|---|---|---|---|---|---|---|
| EVD-0001 | MCP tool contracts | #7 / implementation PR | `server/src/tools/**` | Backend Lead | QA Lead | 2026-09-06 | PR commit and CI run | Local verified; CI pending |
| EVD-0002 | OAuth, authorization, ownership | #4, #5 / implementation PR | `server/src/auth/**`, `server/src/policy/**` | Security Lead | Release Manager | 2026-09-06 | PR commit and CI run | Local verified; independent review pending |
| EVD-0003 | Quote, confirmation, idempotency | #6 / implementation PR | `generation-idempotency.test.mjs` | QA Lead | Security Lead | 2026-09-06 | PR commit and CI run | Local verified; sandbox reconciliation pending |
| EVD-0004 | Upload and SSRF controls | #8 / implementation PR | `upload-ssrf-redaction.test.mjs` | QA Lead | Security Lead | 2026-09-06 | PR commit and CI run | Local verified; real scanner pending |
| EVD-0005 | Automated verification | #11 / implementation PR | `server/tests/**` | QA Lead | Release Manager | 2026-09-06 | PR commit and CI run | Local verified; CI pending |
| EVD-0006 | Plugin package | #10 / implementation PR | `plugins/varoriya-generate/**` | Product/AI Lead | Release Manager | 2026-09-06 | PR commit and CI run | Local validated; production connection pending |

Required lifecycle evidence includes approved plans and requirements, ADRs, threat model, tool schemas, source/build/dependency manifests, automated test results, SIT/UAT/performance/security reports, penetration-test remediation, SBOM, IaC/runbooks/restore evidence, release notes, acceptance approval, and project closure record.

Do not publish tokens, reviewer credentials, user data, raw prompts, user media, complete signed URLs, confidential contracts, or unredacted production logs.
