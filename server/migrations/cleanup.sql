DELETE FROM varoriya_security.quote_records
WHERE expires_at < statement_timestamp() - interval '24 hours';

DELETE FROM varoriya_security.idempotency_records
WHERE retain_until < statement_timestamp();

DELETE FROM varoriya_security.cost_windows
WHERE to_timestamp(reset_at_ms / 1000.0) < statement_timestamp() - interval '30 days';
