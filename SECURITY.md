# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's private security advisory form:

`https://github.com/OpesSemper/varoriya-chatgpt-plugin/security/advisories/new`

Include the affected component/version, impact, reproducible steps, minimal proof of concept, and suggested mitigation. Do not include real user data, active credentials, or destructive payloads.

## Response targets

| Severity | Initial triage | Containment decision | Release rule |
|---|---:|---:|---|
| SEV-0 Critical | 4 hours | 24 hours | Blocks release; immediate escalation |
| SEV-1 High | 1 business day | 3 business days | Fix or authorized risk acceptance |
| SEV-2 Medium | 3 business days | Planned sprint | Track to closure |
| SEV-3 Low | 5 business days | Backlog review | Does not block by default |

The Security Lead assigns final severity. Timelines are targets, not a bug-bounty commitment.

## Supported versions

During pre-release development, only the latest main-branch revision is supported. A supported-version table will be published with the first production release.
