# Varoriya Generate Plugin — End-User Guide

Status: user guide for the repository baseline. Production availability, pricing, supported models, and account permissions must be confirmed from the connected Varoriya service at the time of use.

## What this plugin does

The plugin exposes a quote-first workflow for Varoriya image, video, and audio generation through MCP. It can discover models, obtain a live quote, upload approved input media, submit a confirmed job, poll job status, retrieve an expiring result link, and read the connected account balance.

| Tool | Purpose | Charges credits? |
|---|---|---:|
| `list_models` | Discover models and capabilities | No |
| `quote_generation` | Price the exact request and issue a quote token | No |
| `get_balance` | Read the authenticated account balance | No |
| `upload_input` | Upload input media after validation | May incur storage/provider cost; confirm account terms |
| `generate_image` | Create an image job | Yes, if accepted by Varoriya |
| `generate_video` | Create a video job | Yes, if accepted by Varoriya |
| `generate_audio` | Create an audio job | Yes, if accepted by Varoriya |
| `get_job` | Read a user-owned job and its result | No |

## Installation and connection

1. Install `Varoriya Generate` from the publisher-approved ChatGPT/Codex plugin source.
2. Open the plugin connection settings.
3. Select the publisher-provided production MCP connection, or the explicitly identified non-production connection for testing.
4. Complete the advertised OAuth sign-in and consent flow. Never paste a bearer token, provider API key, or client secret into chat.
5. Confirm that the account, scopes, and region shown by the consent screen are the ones you intend to use.

The repository supports a local development connection, but the local connection is not a production service. The upstream Varoriya documentation is [dev.varoriya.com](https://dev.varoriya.com/). The official Varoriya-hosted MCP URL, if offered by Varoriya, must be obtained and verified from Varoriya; the publisher must have written authorization to use that domain and brand in a directory listing.

## Authentication and permissions

Production access is OAuth-first. Protected tools require an authenticated account and the appropriate scope. Typical scope families in this implementation are `generation:read`, `generation:create`, `billing:read`, and `files:write`. The exact scopes, consent text, token audience, issuer, and account identity are publisher-owned configuration and must be verified before release.

## Image, video, and audio workflow

### 1. Describe the desired result

State the media type, creative prompt, model preferences, dimensions or duration, format, and any input media. If a parameter materially affects price or feasibility, provide it before the quote is requested.

Example: “Create a 16:9 cinematic image of a red fox in a snowy forest. First show available image models and the live price. Do not generate until I confirm.”

### 2. Discover models

The assistant calls `list_models` and presents models compatible with the requested media kind. Do not assume a model name, resolution, duration, or price from an earlier session.

### 3. Request a live quote

The assistant calls `quote_generation` with the selected model, media kind, and exact material parameters. Review the model, prompt/input summary, dimensions, duration, quality, format, quoted cost/unit, and expiry. Changing a material parameter invalidates the earlier quote; a catalog estimate is not a final quote.

### 4. Confirm explicitly

A generation call must not run until you explicitly confirm the exact quoted request and price. Example: “Confirm generation of one 1024px image with model `MODEL_NAME` for `N` credits.” “Sounds good,” silence, an old confirmation, or confirmation after expiry is not sufficient.

### 5. Submit once and retain the job ID

The plugin sends the confirmed request with the quote token and an idempotency key. If the network times out after submission, do not immediately submit a new request. Reconcile the original request/job first. The same idempotency key must not create a second charge or job.

### 6. Poll the job

The assistant calls `get_job` using the authenticated account. Common states are `queued`, `processing`, `completed`, `failed`, and `cancelled`. Polling is bounded and must not continue indefinitely.

## Downloads and expiry

Completed results may be returned as signed, temporary URLs. Download or save the result before expiry and do not share complete signed URLs publicly. If a link expires, ask the plugin to check once for a contract-supported refresh. If refresh is unavailable, regeneration requires a new quote and explicit confirmation. The plugin must never reconstruct or edit a signed URL locally.

## Balance and spending safety

Use `get_balance` before a potentially costly workflow when you need to verify available funds. Balance is not a quote and does not reserve funds. The quote and confirmation remain mandatory for generation. Requests to hide the price, bypass confirmation, reuse an expired quote, or generate for another account are intentionally rejected.

## Common errors

| Error | Meaning | Safe next step |
|---|---|---|
| `AUTH_REQUIRED` / `AUTH_INVALID` | Connection or token is missing/invalid | Reconnect through the official sign-in flow |
| `INSUFFICIENT_BALANCE` | Account cannot cover the quoted request | Check balance or choose a lower-cost request |
| `INVALID_QUOTE` / `PRICE_CHANGED` | Quote is stale, mismatched, or expired | Request a new quote and reconfirm |
| `RESOURCE_FORBIDDEN` / `JOB_NOT_FOUND` | Job/file is not owned by this account or unavailable | Verify account and identifier; do not retry blindly |
| `RATE_LIMITED` | Service is throttling requests | Wait, then retry the same safe read |
| `PROVIDER_UNAVAILABLE` | Provider did not accept or finish the job | Reconcile the existing job before creating another |
| `UPLOAD_REJECTED` | File type, size, content, or URL policy failed | Use an allowed, safe file and try again |
| `VALIDATION_ERROR` | Input does not match the contract | Correct fields and request a new quote if needed |

## Privacy and safety

- Share only prompts and media needed for the current job.
- Do not include passwords, API keys, access tokens, payment secrets, or confidential personal information in prompts or files.
- Obtain rights and consent for uploaded media, voices, likenesses, trademarks, and copyrighted inputs.
- Treat generated media and temporary URLs as private until you decide otherwise.
- The publisher must provide authoritative public privacy policy and terms before directory publication. This repository contains requirements/templates only; it does not make legal claims.

## Uninstall and revoke access

Stop active workflows and save results before links expire. Disconnect the Varoriya account from the plugin, revoke the plugin/client authorization from the identity provider or Varoriya security page if available, uninstall the plugin, and remove local configuration/cache/test credentials according to your retention policy. Use the verified support channel for deletion or account questions.

Publisher support URL, email, response target, and incident channel: `[REQUIRED INPUT: publisher-owned support contact]`.
