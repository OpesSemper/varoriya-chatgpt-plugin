import { AppError } from "../../errors.js";
import type {
  CostLimitStore,
  CostStoreRequest,
  CostStoreResult,
} from "../../policy/cost-limit.js";
import type { PostgresDatabase, SqlQueryExecutor } from "./client.js";
import { assertPostgresDatabase } from "./client.js";
import {
  failClosed,
  onlyRow,
  parseSafeInteger,
  storageUnavailable,
  validateEpochMilliseconds,
  validateOpaqueId,
  validatePositiveDuration,
  validateSubject,
} from "./support.js";

interface CostWindowRow {
  readonly consumed_units: string | number;
  readonly limit_units: string | number;
  readonly reset_at_ms: string | number;
}

interface CostReservationRow {
  readonly cost_units: string | number;
  readonly request_id: string;
}

const INSERT_WINDOW = `
/* varoriya-security:cost-window-insert */
INSERT INTO varoriya_security.cost_windows (
  subject, window_start_ms, reset_at_ms, limit_units, consumed_units
) VALUES ($1, $2, $3, $4, 0)
ON CONFLICT (subject, window_start_ms) DO NOTHING`;

const LOCK_WINDOW = `
/* varoriya-security:cost-window-lock */
SELECT consumed_units, limit_units, reset_at_ms
FROM varoriya_security.cost_windows
WHERE subject = $1 AND window_start_ms = $2
FOR UPDATE`;

const FIND_RESERVATION = `
/* varoriya-security:cost-reservation-find */
SELECT cost_units, request_id
FROM varoriya_security.cost_reservations
WHERE subject = $1
  AND window_start_ms = $2
  AND reservation_key = $3`;

const CONSUME_WINDOW = `
/* varoriya-security:cost-window-consume */
UPDATE varoriya_security.cost_windows
SET consumed_units = consumed_units + $3,
    updated_at = statement_timestamp()
WHERE subject = $1
  AND window_start_ms = $2
  AND consumed_units + $3 <= limit_units
RETURNING consumed_units, limit_units, reset_at_ms`;

const INSERT_RESERVATION = `
/* varoriya-security:cost-reservation-insert */
INSERT INTO varoriya_security.cost_reservations (
  subject, window_start_ms, reservation_key, request_id, cost_units
) VALUES ($1, $2, $3, $4, $5)`;

/** PostgreSQL-backed, fixed-window accounting with a row lock per subject/window. */
export class PostgresCostLimitStore implements CostLimitStore {
  readonly #database: PostgresDatabase;

  public constructor(database: PostgresDatabase) {
    this.#database = assertPostgresDatabase(database);
  }

  public async reserve(request: CostStoreRequest): Promise<CostStoreResult> {
    validateRequest(request);
    return failClosed(() =>
      this.#database.transaction(
        (transaction) => this.reserveWithinTransaction(transaction, request),
        { isolationLevel: "read committed" },
      ),
    );
  }

  /** Used by quote verification so quote locking and accounting commit together. */
  public async reserveWithinTransaction(
    transaction: SqlQueryExecutor,
    request: CostStoreRequest,
  ): Promise<CostStoreResult> {
    validateRequest(request);
    const windowMilliseconds = request.windowSeconds * 1_000;
    const windowStart =
      Math.floor(request.nowEpochMilliseconds / windowMilliseconds) *
      windowMilliseconds;
    const resetAt = windowStart + windowMilliseconds;
    if (!Number.isSafeInteger(windowStart) || !Number.isSafeInteger(resetAt)) {
      throw storageUnavailable(new RangeError("Cost window overflow."));
    }

    await transaction.query(INSERT_WINDOW, [
      request.userId,
      windowStart,
      resetAt,
      request.limitUnits,
    ]);
    const locked = onlyRow(
      (
        await transaction.query<CostWindowRow>(LOCK_WINDOW, [
          request.userId,
          windowStart,
        ])
      ).rows,
    );
    const consumedUnits = parseSafeInteger(
      locked.consumed_units,
      "consumed cost units",
    );
    const storedLimit = parseSafeInteger(locked.limit_units, "cost limit", 1);
    const storedResetAt = parseSafeInteger(
      locked.reset_at_ms,
      "cost reset timestamp",
      1,
    );
    if (storedLimit !== request.limitUnits || storedResetAt !== resetAt) {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "The active cost window does not match the configured policy.",
      });
    }

    const existing = await transaction.query<CostReservationRow>(
      FIND_RESERVATION,
      [request.userId, windowStart, request.reservationKey],
    );
    if (existing.rows.length > 0) {
      const reservation = onlyRow(existing.rows);
      const previousCost = parseSafeInteger(
        reservation.cost_units,
        "reservation cost",
        1,
      );
      if (
        previousCost !== request.costUnits
      ) {
        throw new AppError("INVALID_INPUT", {
          status: 409,
          message: "The reservation key is already bound to another request.",
        });
      }
      return result(
        true,
        true,
        consumedUnits,
        previousCost,
        storedLimit,
        storedResetAt,
      );
    }

    if (consumedUnits + request.costUnits > storedLimit) {
      return result(
        false,
        false,
        consumedUnits,
        request.costUnits,
        storedLimit,
        storedResetAt,
      );
    }
    const updated = onlyRow(
      (
        await transaction.query<CostWindowRow>(CONSUME_WINDOW, [
          request.userId,
          windowStart,
          request.costUnits,
        ])
      ).rows,
    );
    const updatedConsumed = parseSafeInteger(
      updated.consumed_units,
      "consumed cost units",
    );
    await transaction.query(INSERT_RESERVATION, [
      request.userId,
      windowStart,
      request.reservationKey,
      request.requestId,
      request.costUnits,
    ]);
    return result(
      true,
      false,
      updatedConsumed,
      request.costUnits,
      storedLimit,
      storedResetAt,
    );
  }
}

function validateRequest(request: CostStoreRequest): void {
  validateSubject(request.userId);
  validateOpaqueId(request.requestId, "request identifier");
  validateOpaqueId(request.reservationKey, "reservation key");
  validateEpochMilliseconds(request.nowEpochMilliseconds, "Cost timestamp");
  validatePositiveDuration(request.windowSeconds, "Cost window");
  validatePositiveDuration(request.costUnits, "Cost units");
  validatePositiveDuration(request.limitUnits, "Cost limit");
  if (request.costUnits > request.limitUnits) {
    throw new AppError("COST_LIMIT_EXCEEDED", {
      status: 422,
      message: "The requested cost exceeds the configured limit.",
    });
  }
}

function result(
  accepted: boolean,
  duplicate: boolean,
  consumedUnits: number,
  reservationCostUnits: number,
  limitUnits: number,
  resetAtEpochMilliseconds: number,
): CostStoreResult {
  return Object.freeze({
    accepted,
    duplicate,
    consumedUnits,
    reservationCostUnits,
    limitUnits,
    resetAtEpochMilliseconds,
  });
}
