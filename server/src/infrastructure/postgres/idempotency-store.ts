import { randomUUID } from "node:crypto";

import { AppError } from "../../errors.js";
import type {
  IdempotencyAcquireRequest,
  IdempotencyAcquireResult,
  IdempotencyStore,
} from "../../policy/idempotency.js";
import type { GenerationJob } from "../../types/varoriya.js";
import type { PostgresDatabase } from "./client.js";
import { assertPostgresDatabase } from "./client.js";
import {
  failClosed,
  onlyRow,
  storageUnavailable,
  validateEpochMilliseconds,
  validateOpaqueId,
  validatePositiveDuration,
  validateSubject,
} from "./support.js";

interface IdempotencyRow {
  readonly state: "reserved" | "completed";
  readonly request_fingerprint: string;
  readonly lease_id: string | null;
  readonly lease_expires_at_ms: string | number | null;
  readonly retain_until_ms: string | number;
  readonly job_payload: unknown | null;
}

const ACQUIRE_OR_REPLACE_EXPIRED = `
/* varoriya-security:idempotency-acquire */
INSERT INTO varoriya_security.idempotency_records (
  subject,
  idempotency_key,
  state,
  lease_id,
  request_id,
  request_fingerprint,
  lease_expires_at,
  completed_retention_ms,
  retain_until
) VALUES (
  $1, $2, 'reserved', $3, $4, $5,
  to_timestamp($6 / 1000.0),
  $7,
  to_timestamp($6 / 1000.0)
)
ON CONFLICT (subject, idempotency_key) DO UPDATE
SET state = 'reserved',
    lease_id = EXCLUDED.lease_id,
    request_id = EXCLUDED.request_id,
    request_fingerprint = EXCLUDED.request_fingerprint,
    lease_expires_at = EXCLUDED.lease_expires_at,
    completed_retention_ms = EXCLUDED.completed_retention_ms,
    retain_until = EXCLUDED.retain_until,
    job_id = NULL,
    job_payload = NULL,
    quoted_cost_amount = NULL,
    quoted_cost_currency = NULL,
    final_cost_amount = NULL,
    final_cost_currency = NULL,
    completed_at = NULL,
    updated_at = statement_timestamp()
WHERE
  (
    varoriya_security.idempotency_records.state = 'reserved'
    AND varoriya_security.idempotency_records.lease_expires_at
      <= to_timestamp($8 / 1000.0)
  )
  OR
  (
    varoriya_security.idempotency_records.state = 'completed'
    AND varoriya_security.idempotency_records.retain_until
      <= to_timestamp($8 / 1000.0)
  )
RETURNING
  state,
  request_fingerprint,
  lease_id,
  EXTRACT(EPOCH FROM lease_expires_at) * 1000 AS lease_expires_at_ms,
  EXTRACT(EPOCH FROM retain_until) * 1000 AS retain_until_ms,
  job_payload`;

const LOCK_EXISTING = `
/* varoriya-security:idempotency-lock */
SELECT
  state,
  request_fingerprint,
  lease_id,
  EXTRACT(EPOCH FROM lease_expires_at) * 1000 AS lease_expires_at_ms,
  EXTRACT(EPOCH FROM retain_until) * 1000 AS retain_until_ms,
  job_payload
FROM varoriya_security.idempotency_records
WHERE subject = $1 AND idempotency_key = $2
FOR UPDATE`;

const COMPLETE = `
/* varoriya-security:idempotency-complete */
UPDATE varoriya_security.idempotency_records
SET state = 'completed',
    lease_id = NULL,
    lease_expires_at = NULL,
    job_id = $4,
    job_payload = $5::jsonb,
    quoted_cost_amount = $6,
    quoted_cost_currency = $7,
    final_cost_amount = $8,
    final_cost_currency = $9,
    completed_at = to_timestamp($10 / 1000.0),
    retain_until = to_timestamp(($10 + completed_retention_ms) / 1000.0),
    updated_at = statement_timestamp()
WHERE subject = $1
  AND idempotency_key = $2
  AND state = 'reserved'
  AND lease_id = $3
  AND lease_expires_at > to_timestamp($10 / 1000.0)
RETURNING state`;

const ABANDON = `
/* varoriya-security:idempotency-abandon */
DELETE FROM varoriya_security.idempotency_records
WHERE subject = $1
  AND idempotency_key = $2
  AND state = 'reserved'
  AND lease_id = $3`;

/** Durable fenced leases for one provider submission per `(subject,key)`. */
export class PostgresIdempotencyStore implements IdempotencyStore {
  readonly #database: PostgresDatabase;
  readonly #leaseId: () => string;

  public constructor(
    database: PostgresDatabase,
    options: { readonly leaseId?: () => string } = {},
  ) {
    this.#database = assertPostgresDatabase(database);
    this.#leaseId = options.leaseId ?? randomUUID;
  }

  public async acquire(
    request: IdempotencyAcquireRequest,
  ): Promise<IdempotencyAcquireResult> {
    validateAcquireRequest(request);
    const leaseId = this.#leaseId();
    validateOpaqueId(leaseId, "lease identifier");
    const leaseExpiresAt =
      request.nowEpochMilliseconds + request.reservationTtlMilliseconds;
    if (!Number.isSafeInteger(leaseExpiresAt)) {
      throw storageUnavailable(new RangeError("Idempotency lease overflow."));
    }

    return failClosed(() =>
      this.#database.transaction(async (transaction) => {
        const acquired = await transaction.query<IdempotencyRow>(
          ACQUIRE_OR_REPLACE_EXPIRED,
          [
            request.subject,
            request.key,
            leaseId,
            request.requestId,
            request.requestFingerprint,
            leaseExpiresAt,
            request.completedRetentionMilliseconds,
            request.nowEpochMilliseconds,
          ],
        );
        if (acquired.rows.length === 1) {
          return Object.freeze({ status: "acquired" as const, leaseId });
        }
        if (acquired.rows.length !== 0) throw storageUnavailable();

        const current = onlyRow(
          (
            await transaction.query<IdempotencyRow>(LOCK_EXISTING, [
              request.subject,
              request.key,
            ])
          ).rows,
        );
        if (current.request_fingerprint !== request.requestFingerprint) {
          throw new AppError("INVALID_INPUT", {
            status: 409,
            message: "The idempotency key is already bound to another request.",
          });
        }
        if (current.state === "completed") {
          const job = parseJob(current.job_payload);
          return Object.freeze({ status: "completed" as const, job });
        }
        if (current.state === "reserved") {
          return Object.freeze({ status: "in-progress" as const });
        }
        throw storageUnavailable();
      }, { isolationLevel: "read committed" }),
    );
  }

  public async complete(
    subject: string,
    key: string,
    leaseId: string,
    job: GenerationJob,
    nowEpochMilliseconds: number,
  ): Promise<void> {
    validateSubject(subject);
    validateOpaqueId(key, "idempotency key", 128);
    validateOpaqueId(leaseId, "lease identifier");
    validateEpochMilliseconds(nowEpochMilliseconds, "Completion timestamp");
    validateJob(job);
    await failClosed(async () => {
      const completed = await this.#database.query(COMPLETE, [
        subject,
        key,
        leaseId,
        job.job_id,
        JSON.stringify(job),
        job.quoted_cost?.amount ?? null,
        job.quoted_cost?.currency ?? null,
        job.final_cost?.amount ?? null,
        job.final_cost?.currency ?? null,
        nowEpochMilliseconds,
      ]);
      if (completed.rows.length !== 1) throw storageUnavailable();
    });
  }

  public async abandonBeforeSubmission(
    subject: string,
    key: string,
    leaseId: string,
  ): Promise<void> {
    validateSubject(subject);
    validateOpaqueId(key, "idempotency key", 128);
    validateOpaqueId(leaseId, "lease identifier");
    await failClosed(async () => {
      await this.#database.query(ABANDON, [subject, key, leaseId]);
    });
  }
}

function validateAcquireRequest(request: IdempotencyAcquireRequest): void {
  validateSubject(request.subject);
  validateOpaqueId(request.key, "idempotency key", 128);
  if (request.key.length < 16) {
    throw new TypeError("Idempotency keys must contain at least 16 characters.");
  }
  validateOpaqueId(request.requestId, "request identifier");
  if (!/^[A-Za-z0-9_-]{43}$/.test(request.requestFingerprint)) {
    throw new AppError("INVALID_INPUT", {
      status: 400,
      message: "The idempotency request fingerprint is invalid.",
    });
  }
  validateEpochMilliseconds(request.nowEpochMilliseconds, "Acquisition timestamp");
  validatePositiveDuration(
    request.reservationTtlMilliseconds,
    "Reservation TTL",
  );
  validatePositiveDuration(
    request.completedRetentionMilliseconds,
    "Completed retention",
  );
}

function validateJob(job: GenerationJob): void {
  if (!job || typeof job !== "object") throw new TypeError("A job is required.");
  validateOpaqueId(job.job_id, "job identifier");
  if (JSON.stringify(job).length > 1_000_000) {
    throw new TypeError("The completed job payload is too large.");
  }
}

function parseJob(value: unknown): GenerationJob {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch (error) {
      throw storageUnavailable(error);
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw storageUnavailable();
  }
  const job = candidate as GenerationJob;
  validateJob(job);
  return Object.freeze({ ...job });
}
