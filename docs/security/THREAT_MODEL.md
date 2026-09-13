# Varoriya gateway threat model

Status: release-candidate engineering threat model. Security Lead acceptance and live-environment testing remain required.

## Assets and trust boundaries

Protected assets are OAuth credentials, account identity/scopes, prompts/media, quote tokens and prices, cost/idempotency ledgers, file/job ownership, provider jobs, signed result URLs, logs/evidence, and publisher configuration. Trust boundaries are ChatGPT-to-gateway, OAuth/JWKS, gateway-to-PostgreSQL, gateway-to-ClamAV, gateway-to-Varoriya, and result delivery.

## Threats and controls

| ID | Threat | Sev | Prevent/detect control | Evidence / residual gate |
|---|---|---:|---|---|
| TM-01 | Forged/replayed/wrong-audience token | S0 | JOSE signature, exact issuer/audience/algorithm/time claims, exact scopes | auth tests; live issuer/key-rotation test pending |
| TM-02 | Cross-account job/file access | S0 | trusted subject claim, immutable ownership rows, default deny before provider read/write | ownership negative tests; sandbox cross-account test pending |
| TM-03 | Quote tampering, expiry, or parameter swap | S0 | server-recorded digest and immutable claims; canonical binding and expiry | quote tests; provider authenticity contract pending |
| TM-04 | Duplicate job/charge or cost-limit bypass | S0 | request HMAC fingerprint, fenced durable idempotency, per-generation cost reservation, no blind retries | concurrency/store tests; live reconciliation pending |
| TM-05 | Malware/polyglot/oversized upload | S1 | base64/body cap, filename/MIME/magic checks, isolated ClamAV, fail closed | local protocol tests; deployed scanner exercise pending |
| TM-06 | SSRF and DNS rebinding | S1 | remote URLs disabled; exact host/port, HTTPS, IP/DNS/rebinding checks if enabled; Host validation | SSRF/transport tests; ingress review pending |
| TM-07 | Prompt/token/signed-URL leakage | S0 | no body logging, recursive redaction, fixed metric labels, digest-only storage | redaction tests; production collector review pending |
| TM-08 | Provider/schema/error spoofing | S1 | typed allowlisted parser, safe error mapping, HTTPS-only results, timeouts, no retries | provider tests; Varoriya sandbox pending |
| TM-09 | Database/scanner outage or corrupt result | S1 | fail-closed adapters, bounded readiness, transactions/row locks | adapter/readiness tests; failover/restore exercise pending |
| TM-10 | Unauthorized deployment/publication | S0 | protected branches/PR evidence, three-cycle review cap, human release/legal gates | GitHub/portal approval records pending |
| TM-11 | Supply-chain compromise | S1 | lockfile, pinned Actions SHAs, dependency audit, immutable image/SBOM requirement | local audit; image scan/SBOM attestation pending |
| TM-12 | Brand/domain or data-processing misrepresentation | S0 | publisher/domain verification and written Varoriya/legal authorization | external legal/contract evidence required |

## Abuse cases

- Attempt generation without seeing/confirming the current exact quote.
- Reuse an idempotency key with another prompt/model/file set.
- Reuse one quote with multiple idempotency keys to evade accounting.
- Supply another user’s job/file ID.
- Include a credential in prompt/media/URL/header and attempt to trigger logging.
- Send oversized/malformed JSON or base64, mismatched MIME, malware, private IP URL, or rebinding DNS.
- Force a provider timeout and induce a blind retry.
- Submit the official Varoriya domain/brand without authority.

## Release rule

No open S0 residual gate can be accepted by a sub-agent. Security, billing, legal, production, and publication decisions require the named human owner and linked redacted evidence.
