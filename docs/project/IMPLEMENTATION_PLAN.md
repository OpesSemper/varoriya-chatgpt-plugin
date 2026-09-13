# Implementation plan — Version 2.0

Baseline date: 2026-09-04. This plan aligns project governance and evidence with the selected SoftwareDevelopmentStandard materials for ISO/IEC 29110 and ISO/IEC 27001.

## Severity method

Score Complexity, Dependency centrality, Security/Audit impact, and Reversibility from 1–4. Use the highest relevant release impact:

| Severity | Meaning | Release rule |
|---|---|---|
| SEV-0 | Critical gate, foundational dependency, or severe security/billing/publication risk | blocks dependent work and release |
| SEV-1 | High complexity/impact or major dependency | independent review; fix or authorized risk acceptance |
| SEV-2 | Medium localized work | standard review and sprint closure |
| SEV-3 | Low-risk enhancement | backlog priority; no default release block |

OAuth/authorization, billing/idempotency, public MCP origin, production release, and directory publication are always SEV-0.

## Sub-Agent roster

| Agent | Model | Effort | Primary scope | Human gate |
|---|---|---:|---|---|
| SA-ARCH | `gpt-5.6-sol` | xhigh | architecture, trust boundaries, ADR drafts | Solution Architect |
| SA-SEC | `gpt-5.6-sol` | xhigh | threat model, OAuth, abuse and security review | Security Lead |
| SA-BE | `gpt-5.6-terra` | high | MCP/API implementation, billing safety, operations | Backend/DevOps Leads |
| SA-OPS | `gpt-5.6-terra` | high | production operations, telemetry, health, deployment/runbooks | DevOps/SRE Lead |
| SA-QA | `gpt-5.6-luna` | high | test design, automation, traceability evidence | QA Lead |
| SA-DOCS | `gpt-5.6-luna` | medium | SRS, public docs, submission package | Product/Legal/ISO SME |
| SA-REVIEW | `gpt-5.6-sol` | high | independent release/security/compliance review | Release Manager |

Model assignments are execution defaults, not approval authority. Human owners remain accountable.

## Dependency-critical work breakdown

| ID | Work item | Sev | Depends on | Human owner | Sub-Agent |
|---|---|---:|---|---|---|
| GOV-001 | Approve publisher, scope, data classification, and authority | S0 | — | Business Owner | SA-DOCS / medium |
| REQ-001 | Baseline use cases, SRS, schemas, and acceptance criteria | S0 | GOV-001 | Product/Delivery | SA-ARCH / high |
| ARCH-001 | Freeze public MCP origin, ADRs, and integration boundaries | S0 | REQ-001 | Solution Architect | SA-ARCH / xhigh |
| SEC-001 | OAuth metadata, PKCE, audience, and token lifecycle | S0 | ARCH-001 | Security Lead | SA-SEC / xhigh |
| SEC-002 | Scopes, ownership checks, default deny, and negative auth tests | S0 | SEC-001 | Security Lead | SA-SEC / xhigh |
| TOOL-001 | Implement eight focused MCP tool contracts | S1 | REQ-001, ARCH-001 | Backend Lead | SA-BE / high |
| COST-001 | Live quote, signed token, idempotency ledger, and reconciliation | S0 | TOOL-001, SEC-002 | Backend/Finance | SA-BE / high; SA-SEC review / xhigh |
| FILE-001 | Secure upload, MIME/size checks, SSRF and malware controls | S1 | TOOL-001, SEC-002 | Backend/AppSec | SA-SEC / xhigh |
| OPS-001 | Logging, monitoring, alerts, retention, and incident evidence | S1 | ARCH-001, TOOL-001 | DevOps/SRE | SA-OPS / high |
| PKG-001 | Plugin manifest, app mapping, and generation workflow skill | S1 | TOOL-001, SEC-002 | Product/AI Lead | SA-DOCS / medium |
| QA-001 | Unit, integration, auth, abuse, retry, load, and E2E suite | S1 | COST-001, FILE-001 | QA Lead | SA-QA / high |
| COMP-001 | Requirement-control-test-evidence-release traceability | S1 | REQ-001, QA-001 | ISO SME | SA-DOCS / medium |
| SUB-001 | Listing, legal URLs, demo, reviewer credentials, and test package | S1 | PKG-001, QA-001, COMP-001 | Product/Legal | SA-DOCS / medium |
| REV-001 | Independent release/security/compliance verification | S0 | SUB-001 | Release Manager | SA-REVIEW / high |
| REL-001 | Production release and public directory publication | S0 | REV-001 approved | Business Owner | SA-REVIEW / high |
| UI-001 | Optional job/gallery UI after Version 1 | S3 | REL-001 | Product Owner | SA-QA / medium |

## Release definition of done

- MCP production deployment has rollback and backward-compatible contract policy.
- Contract, auth, abuse, retry, load, and end-to-end tests pass in CI.
- Secrets, raw prompts, full signed URLs, and sensitive data are absent from logs.
- Pricing/model catalog reconciliation passes; one idempotency key creates at most one charge and job.
- Local plugin installation works for every starter prompt and required negative case.
- Security, privacy, business-owner, and release approvals are linked.
- Submission metadata equals the scanned release source.

## Human-only approvals

Sub-Agents cannot accept residual risk, approve production access, spend credits, publish legal/privacy statements, create/distribute reviewer credentials, release to production, or submit/publish the plugin. Those gates require the named authorized human.

## Review-cycle policy

Each release candidate is reviewed at most three times:

1. Cycle 1 — integration review of delegated and main-agent changes.
2. Cycle 2 — complete release verification against code, tests, documents, and gates.
3. Cycle 3 — corrective review only if CI or an external reviewer identifies a new defect.

If Cycle 2 passes, Cycle 3 is not performed. A material contract, security, or architecture change creates a new release candidate and review record instead of silently reusing the previous approval.

## Implementation checkpoint — 2026-09-06

- SA-SEC (`gpt-5.6-sol`, xhigh): OAuth/authentication boundary, scopes, ownership, cost, quote/idempotency, upload, SSRF, redaction, and fail-closed production controls.
- SA-BE (`gpt-5.6-terra`, high): typed Varoriya REST adapter and eight MCP tool contracts.
- SA-QA (`gpt-5.6-luna`, high): direct-source security and contract suite with no skip fallback.
- SA-DOCS (`gpt-5.6-luna`, medium): plugin package, workflow skill, eval prompts, and local runbook.
- Main Agent: Streamable HTTP composition, JOSE/JWKS adapter, development-only secure stores, CI, Docker, integration fixes, and GitHub delivery.

This checkpoint is an implementation candidate, not production acceptance. OPS-001, production adapters, live sandbox contract tests, independent REV-001, legal metadata, public hosting, and REL-001 remain open.

## Release-candidate checkpoint — 2026-09-13

| Workstream | Owner assignment | Implemented evidence | Remaining gate |
|---|---|---|---|
| SEC-001/SEC-002/COST-001/FILE-001 | SA-SEC, `gpt-5.6-sol`, xhigh; completed by Main Agent after quota interruption | production OAuth requirements, PostgreSQL ownership/quote/cost/idempotency adapters, ClamAV, migrations, fail-closed tests | live Varoriya OAuth/sandbox and independent approval |
| OPS-001 | SA-OPS, `gpt-5.6-terra`, high | structured redacted logging, metrics, correlation, `/livez`, `/readyz`, bounded shutdown, production runbook/deploy reference | platform exporter, alert and restore exercises |
| QA-001 | SA-QA, `gpt-5.6-luna`, high; completed by Main Agent after quota interruption | 49 passing local tests including 6 positive and 5 negative submission cases | MCP Inspector, API Playground, ChatGPT developer mode, sandbox evidence |
| PKG-001/SUB-001 | SA-DOCS, `gpt-5.6-luna`, medium; completed by Main Agent after quota interruption | plugin v0.2 release candidate, bilingual user/admin guides, listing/legal/submission docs | publisher URLs/assets, portal app ID, reviewer account |
| COMP-001/REV-001 | Main Agent + SA-REVIEW assignment, `gpt-5.6-sol`, high | release checklist, validator, evidence/traceability update, three-cycle review cap | Cycle 2 and authorized Release Manager approval |

Cycle 1 status: code integration and local tests complete. Cycle 2 starts only after repository delivery and CI evidence are available. REL-001 remains blocked until every SEV-0 external/human gate is complete.
