# Production deployment assets

`docker-compose.production.example.yml` is a hardened reference composition, not a deployment command. It intentionally has placeholder public URLs and no secrets.

Before applying any manifest, complete the production gates in `docs/runbooks/production-operations.md`, supply runtime secrets through an approved secret manager, provision PostgreSQL and ClamAV on private networks, and put TLS ingress in front of the private container port. Route traffic using `/readyz`, not the shallow `/healthz` endpoint. Do not mount a Docker socket, host filesystem, or source repository into the running container.
