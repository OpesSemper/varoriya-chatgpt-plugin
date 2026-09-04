# Contributing

## Before starting

1. Work from an approved GitHub Issue.
2. Confirm Severity, Phase, Human Owner, Sub-Agent, Dependencies, ISO Mapping, acceptance criteria, and evidence requirements.
3. For SEV-0 or SEV-1 work, confirm the required architecture/security review before implementation.

## Branch and commit conventions

- Branch: `<type>/<issue-id>-<short-name>`, for example `feat/TOOL-001-tool-contracts`.
- Commit: `<type>(<scope>): <summary>`, for example `feat(mcp): add quote contract`.
- Keep generated files, secrets, production data, reviewer credentials, and raw user media out of git.

## Pull requests

- Link the governing issue and preserve dependency order.
- Include tests, negative tests, and evidence appropriate to severity.
- Update requirements, architecture decisions, traceability, runbooks, or threat controls when behavior changes.
- Require independent review for SEV-0/SEV-1 and release changes.
- Human approval is mandatory for security-risk acceptance, production release, legal/privacy decisions, spend, and public directory submission.

## Definition of done

- Acceptance criteria pass and are linked to reproducible evidence.
- Requirement → control → test → evidence → release traceability is updated.
- Security, privacy, billing, and ownership checks pass where applicable.
- No secrets or sensitive user data appear in code, tests, logs, or artifacts.
- Documentation and rollback impact are reviewed.
