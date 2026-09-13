# ADR-004: Upload validation and malware boundary

- Status: Accepted for release candidate; deployed scanner exercise pending
- Severity: SEV-1
- Owners: AppSec and Backend Leads
- Sub-Agent assignment: SA-SEC (`gpt-5.6-sol`, xhigh), completed/integrated by Main Agent

## Decision

The Version 1 tool accepts base64 JSON uploads up to 10 MiB decoded. The gateway rejects malformed encoding, unsafe filenames, unsupported declared types, magic-byte mismatches, and oversized media before scanning. Production sends validated bytes to an isolated ClamAV service using bounded INSTREAM frames and fails closed for malicious, unknown, timeout, transport, or oversized responses.

Remote URL ingestion remains disabled by default. If enabled by an approved change, exact host/port policy, HTTPS, DNS resolution, private/link-local address denial, and rebinding checks are mandatory.

## Consequences

Large media requires a separately reviewed streaming/presigned design. ClamAV is a required readiness dependency. Scanner signatures, resource limits, quarantine/retention, privacy, and false-positive handling remain platform controls.

## Rollback and verification

If scanner health or upload isolation fails, disable upload/generation paths rather than bypass scanning. Automated evidence is in `upload-ssrf-redaction.test.mjs`, `gateway-transport.test.mjs`, and `production-security.test.mjs`. Production approval requires a scanner exercise with benign/malicious fixtures and no real user media.
