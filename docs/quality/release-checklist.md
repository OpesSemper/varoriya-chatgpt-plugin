# Varoriya Plugin Release Checklist

This checklist is the SEV-1 submission gate for the public Varoriya MCP plugin. It is intentionally split between reproducible local evidence and external/manual evidence.

## No-credit local gate

Run from the repository root:

```bash
cd server
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
cd ..
node scripts/validate-plugin.mjs
node scripts/release/validate-submission.mjs
```

The release harness uses local fake clients, fixture identities, zero-cost credit values, and loopback HTTP only. A passing local run is not evidence that a real Varoriya account, OAuth issuer, or public endpoint works.

Pull-request CI runs `validate-submission.mjs --allow-publisher-inputs`. That mode may waive only explicit publisher-input marker fields in guide/publishing documents; missing files, malformed JSON, secrets, and all other placeholders still fail. The strict command above has no waiver and must pass before submission.

## Automated acceptance

- All existing and release-specific tests pass.
- No skipped, unfinished, or quarantined release cases are accepted.
- Tool names, JSON schemas, required fields, and safety annotations match the published contract.
- Public discovery is unauthenticated; protected calls return an authentication challenge before provider access.
- Quote binding includes subject, model, media kind, canonical parameters, cost ceiling, and expiry.
- Confirmation is explicit and false confirmation cannot reach a provider write.
- Idempotency is subject-scoped and concurrent duplicate submissions cause at most one local provider submission.
- Job and input-file ownership are checked before provider access.
- Logs and public errors contain no credentials, prompts, media, quote tokens, or signed URL secrets.
- Submission material is present and contains no unresolved publish placeholders or high-confidence credential patterns.

## Manual and external gates

The following gates remain `PENDING_MANUAL_EXECUTION` or `PENDING_EXTERNAL_VALIDATION` until a reviewer executes them and records evidence in [release-evidence-template.md](../evals/release-evidence-template.md):

1. MCP Inspector interoperability.
2. API Playground HTTP and schema behavior.
3. ChatGPT developer-mode connection through public HTTPS and OAuth metadata.
4. Varoriya OAuth-to-REST sandbox behavior, including real quote and job lifecycle.
5. Human security, privacy, terms, rollback, and directory-submission approval.

No production deployment, directory submission, or real-credit generation is authorized by local test success alone.

## Review limit

Do not repeat review more than three times for one release candidate. Cycle 1 covers integration, Cycle 2 is the complete release check, and Cycle 3 is used only for a defect reported by CI or an external reviewer. A clean Cycle 2 closes review.

## Evidence integrity

Evidence must contain commit SHA, test command, timestamp, environment class, case IDs, pass/fail result, and reviewer identity. Redact bearer tokens, API keys, quote tokens, prompts, media, complete signed URLs, and provider response bodies containing secrets. Use fixture values for local evidence and never paste real credentials into this repository.
