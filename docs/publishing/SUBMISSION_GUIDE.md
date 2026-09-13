# ChatGPT directory submission guide

This guide separates code readiness from the external actions required to deploy, review, and publish the MCP integration.

## 1. Establish publisher authority

The repository owner must confirm who owns and operates the public MCP origin, OAuth client, legal policies, support process, and listing. Because `varoriya.com` is a third-party domain/brand unless documented otherwise, do not submit an endpoint or listing that implies ownership, partnership, or trademark permission without written authorization.

Required evidence:

- verified OpenAI developer/business identity and Apps Management Write permission;
- publisher-owned domain and ability to complete domain verification;
- Varoriya integration/brand authorization or approved independent-integration wording;
- privacy, terms, support, website, and logo approvals;
- a reviewer account that does not require MFA or private-network access during review.

## 2. Deploy the release candidate

1. Build from an immutable commit and record the image digest/SBOM.
2. Apply the PostgreSQL migration with an approved migration identity.
3. Configure OAuth, database, ClamAV, Varoriya base URL, exact model policies, limits, and operational timeouts through managed configuration/secrets.
4. Place TLS ingress in front of the private application port and apply WAF/rate/egress policies.
5. Route traffic only when `/readyz` passes.
6. Validate OAuth protected-resource metadata and the Streamable HTTP `/mcp` endpoint.
7. Run redacted no-charge smoke checks before any approved sandbox generation.

## 3. Register and test in ChatGPT

Use the publisher account to create/register the MCP integration in the OpenAI platform flow and capture the resulting technical application identifier. Do not fabricate or commit an `.app.json` identifier before the platform creates it.

Test the deployed endpoint with:

- MCP Inspector;
- API Playground;
- ChatGPT developer mode;
- at least five positive and three negative reviewer cases;
- an approved Varoriya sandbox or no-charge account for quote, confirmation, generation, idempotency, ownership, and polling.

Record results in `docs/evals/release-evidence-template.md`. Evidence must reference the release commit and redact all credentials, prompts, media, quote tokens, complete signed URLs, and sensitive provider responses.

## 4. Run release gates

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

All automated checks must pass. Every manual/external gate in `docs/quality/release-checklist.json` must have linked evidence. Resolve every `[REQUIRED INPUT: ...]` value with approved, public material.

## 5. Submit for review

Submit the production HTTPS MCP endpoint and listing through the OpenAI dashboard/portal. Complete tool-level metadata, OAuth details, legal/support links, category, logo, test prompts, negative cases, and private reviewer instructions. The submitted metadata must match the deployed release and repository evidence.

The release manager records the submission timestamp, source commit, deployment digest, portal application ID, reviewer package, and approvers. Never copy the reviewer password into GitHub.

## 6. Respond to review

Treat reviewer feedback as controlled change. Link each finding to an issue and evidence. The project review policy allows at most three review cycles per release candidate:

1. integration review;
2. full release verification;
3. corrective review only when CI or an external reviewer identifies a defect.

If cycle 2 passes, do not perform cycle 3. A material code/contract/security change starts a new release candidate and review record; it does not silently reuse an approval.

## 7. Publish and monitor

Approval does not itself authorize publication. The authorized business owner makes the final publish decision, confirms support/on-call readiness, and records the release. After publication, monitor authentication failures, readiness, provider outcomes, unexpected charges, duplicate generation, and support reports. Follow the rollback/incident procedure immediately for a security or billing invariant breach.

## External blockers for this repository

- Production domain/origin: `[REQUIRED INPUT: HTTPS origin]`
- OpenAI application/portal ID: `[REQUIRED INPUT: generated platform identifier]`
- Publisher verification/permission evidence: `[REQUIRED INPUT: approval reference]`
- Varoriya sandbox and OAuth-to-REST confirmation: `[REQUIRED INPUT: evidence reference]`
- Legal/support/logo URLs and approvals: `[REQUIRED INPUT: evidence references]`
- Reviewer access and manual test evidence: `[REQUIRED INPUT: private delivery/evidence references]`
