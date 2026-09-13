BEGIN;
DROP TABLE IF EXISTS varoriya_security.idempotency_records;
DROP TABLE IF EXISTS varoriya_security.quote_records;
DROP TABLE IF EXISTS varoriya_security.cost_reservations;
DROP TABLE IF EXISTS varoriya_security.cost_windows;
DROP TABLE IF EXISTS varoriya_security.resource_owners;
DROP SCHEMA IF EXISTS varoriya_security;
COMMIT;
