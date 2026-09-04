# GitHub project-management setup

## Repository

- Target: `OpesSemper/varoriya-chatgpt-plugin`
- Visibility: Public
- Default branch: `main`
- Issues and private vulnerability reporting: Enabled
- Merge method: Squash only
- Delete head branches after merge: Enabled
- Branch protection/ruleset: pull request required, stale approvals dismissed, conversation resolution required, status checks required after CI exists, force pushes and deletion blocked

Do not require a CI status check until the workflow has produced at least one successful run; otherwise the ruleset can deadlock the initial setup.

## Labels

Create label groups:

- Severity: `severity:sev-0`, `severity:sev-1`, `severity:sev-2`, `severity:sev-3`
- Type: `type:task`, `type:defect`, `type:risk`, `type:change`, `type:adr`, `type:evidence`
- Status: `status:backlog`, `status:ready`, `status:blocked`, `status:review`, `status:accepted`
- Area: `area:architecture`, `area:security`, `area:mcp`, `area:billing`, `area:upload`, `area:qa`, `area:compliance`, `area:release`

## Milestones

1. M0 Eligibility & Baseline
2. M1 Architecture & Contracts
3. M2 Security & Core Build
4. M3 Verification & Operations
5. M4 Submission Candidate
6. M5 Production & Publication

## Project fields

| Field | Type | Values or rule |
|---|---|---|
| Status | Single select | Backlog, Ready, In Progress, In Review, Blocked, Done |
| Severity | Single select | SEV-0, SEV-1, SEV-2, SEV-3 |
| Phase | Single select | 0 Eligibility through 7 Review |
| Human Owner | Text/person | accountable human role/user |
| Sub-Agent | Text | agent ID / model / effort |
| Dependencies | Text | issue numbers and blocked-by links |
| ISO Mapping | Text | clause/control/work-product IDs |
| Evidence | Single select | Required, Ready, Accepted |
| Target | Iteration | sprint or milestone |

## Views

- Roadmap — group by Phase, sort by Target
- Critical Path — filter SEV-0/SEV-1 and incomplete, show Dependencies
- Security & Compliance — filter security/compliance areas, show ISO Mapping and Evidence
- Release Readiness — group by milestone, filter M4/M5, show approval/evidence state
- Sub-Agent Work — group by Sub-Agent, show Human Owner and review state
- Risks & Changes — filter `type:risk` or `type:change`

## Operating rules

- Update status in the issue/project, not in private notes.
- A blocked issue must link its blocker; do not bypass dependency gates.
- Every sprint/release records demo, decisions, defects, change requests, and traceability updates.
- Changes to an approved SRS/architecture/security baseline require a change request with scope, schedule, cost, security, privacy, and auditability impact.
- A SEV-0 closure requires independent review and the named human approval.
- Release artifacts must be signed/tagged and linked to SBOM, test/security evidence, runbook, rollback, and acceptance record.
