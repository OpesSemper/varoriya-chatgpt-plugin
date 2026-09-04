# Initial issue backlog

The logical ID is the stable dependency key; GitHub issue numbers are recorded in [ISSUE_INDEX.md](ISSUE_INDEX.md). Copy each ID into the issue title and dependency field.

| Order | Issue title | Severity | Dependencies | Milestone |
|---:|---|---:|---|---|
| 1 | `[GOV-001] Approve publisher, scope, data classification, and authority` | SEV-0 | None | M0 Eligibility & Baseline |
| 2 | `[REQ-001] Baseline use cases, SRS, tool schemas, and acceptance criteria` | SEV-0 | GOV-001 | M0 Eligibility & Baseline |
| 3 | `[ARCH-001] Freeze public MCP origin, ADRs, and integration boundaries` | SEV-0 | REQ-001 | M1 Architecture & Contracts |
| 4 | `[SEC-001] Implement OAuth metadata, PKCE, audience, and token lifecycle` | SEV-0 | ARCH-001 | M2 Security & Core Build |
| 5 | `[SEC-002] Enforce scopes, ownership, default deny, and negative auth tests` | SEV-0 | SEC-001 | M2 Security & Core Build |
| 6 | `[TOOL-001] Implement eight focused MCP tool contracts` | SEV-1 | REQ-001, ARCH-001 | M1 Architecture & Contracts |
| 7 | `[COST-001] Add live quote, signed token, idempotency, and reconciliation` | SEV-0 | TOOL-001, SEC-002 | M2 Security & Core Build |
| 8 | `[FILE-001] Harden upload validation, SSRF, and malware controls` | SEV-1 | TOOL-001, SEC-002 | M2 Security & Core Build |
| 9 | `[OPS-001] Add logging, monitoring, retention, alerts, and incident evidence` | SEV-1 | ARCH-001, TOOL-001 | M3 Verification & Operations |
| 10 | `[PKG-001] Build plugin package, app mapping, and generation skill` | SEV-1 | TOOL-001, SEC-002 | M2 Security & Core Build |
| 11 | `[QA-001] Build automated functional, auth, abuse, retry, load, and E2E tests` | SEV-1 | COST-001, FILE-001 | M3 Verification & Operations |
| 12 | `[COMP-001] Complete requirement-control-test-evidence-release traceability` | SEV-1 | REQ-001, QA-001 | M3 Verification & Operations |
| 13 | `[SUB-001] Prepare listing, legal URLs, demo, reviewer access, and test package` | SEV-1 | PKG-001, QA-001, COMP-001 | M4 Submission Candidate |
| 14 | `[REV-001] Perform independent release, security, and compliance verification` | SEV-0 | SUB-001 | M4 Submission Candidate |
| 15 | `[REL-001] Release production version and publish to directory` | SEV-0 | REV-001 approved | M5 Production & Publication |
| 16 | `[UI-001] Evaluate optional job/gallery UI after Version 1` | SEV-3 | REL-001 | Post-v1 |

Each issue must use the engineering-task template and include the matching Human Owner, Sub-Agent/model/effort, ISO mapping, acceptance criteria, and required evidence from the implementation plan.
