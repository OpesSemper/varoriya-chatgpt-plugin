# Varoriya Generate quick guide

1. Describe the desired image, video, or audio and material parameters.
2. Use `list_models`; never assume a model or price from an earlier session.
3. Use `quote_generation` for the exact request.
4. Show the model, parameters, price, and expiry, then ask for explicit confirmation.
5. After confirmation, call one matching `generate_*` tool with a fresh idempotency key.
6. Preserve the job ID and use bounded `get_job` polling.
7. Deliver the result with its expiry warning; never reconstruct a signed URL.

Never ask a user to paste access tokens, provider keys, or client secrets. If a call times out after submission, reconcile the existing request before creating another job. Full English and Thai guides are in `docs/guides/` in the repository.
