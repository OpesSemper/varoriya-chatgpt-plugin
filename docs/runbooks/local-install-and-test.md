# Local install and test runbook

This runbook installs the repository-local plugin and verifies its public-safe workflow with a mock or approved non-production MCP connection. It does not create production credentials, publish a directory listing, or spend credits.

## Prerequisites

- Codex CLI with local plugin support.
- Python 3.10 or newer for validation.
- A checkout of this repository.
- A mock fixture or an approved non-production endpoint implementing the repository tool contracts.
- No secrets committed to the repository or passed in shell history.

## Validate the package

From the repository root, run:

```bash
python3 /root/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/varoriya-generate
```

The validator must report success. Confirm that the manifest has repository and publisher metadata, that no privacy or terms URL is present before those documents exist, and that no production MCP connection identifier is embedded.

## Install locally

The repository-local marketplace is `.agents/plugins/marketplace.json`. Use the marketplace name from that file and install the plugin from the checkout using the local plugin workflow supported by the current Codex CLI. The source path must resolve to `./plugins/varoriya-generate` relative to the marketplace file.

After installation, start a new Codex thread so the updated skill set is discovered. Confirm that the plugin appears as `Varoriya Generate` and that the installed version is `0.1.0`.

## Run the safe workflow checks

1. Run evaluation prompts EVAL-001, EVAL-003, EVAL-005, EVAL-007, EVAL-008, EVAL-009, and EVAL-010 against the mock or approved non-production endpoint.
2. Confirm that `list_models` precedes quoting and that `quote_generation` precedes every generation side effect.
3. Confirm that the user sees model, material parameters, price, and quote expiry before confirmation.
4. Confirm that changing a material parameter invalidates the earlier quote.
5. Confirm that repeated submission with the same idempotency key produces at most one charge and one job.
6. Confirm that polling stops at a known terminal state or a bounded in-progress result.
7. Confirm that completed delivery includes result expiry and that expired links do not get reconstructed locally.
8. Confirm that auth, ownership, insufficient balance, stale quote, rate limit, and provider failure cases fail closed without secrets in output.

Record each run using `docs/evals/results-template.md`. Redact tokens, signed URLs, raw private prompts, private media, and provider credentials.

## Release gates

Local validation is not production approval. Production connection identifiers, OAuth metadata, privacy and terms URLs, reviewer credentials, billing approval, security review, and directory submission remain human-owned gates. Do not add those values until the relevant owner approves and the repository contains the authoritative public documents.
