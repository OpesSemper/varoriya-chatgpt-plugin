import type { CostPolicyConfig, RuntimeEnvironment } from "../config.js";
import { AppError } from "../errors.js";

export interface CostReservation {
  readonly userId: string;
  readonly requestId: string;
  readonly reservationKey: string;
  readonly costUnits: number;
}

export interface CostStoreRequest extends CostReservation {
  readonly limitUnits: number;
  readonly windowSeconds: number;
  readonly nowEpochMilliseconds: number;
}

export interface CostStoreResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly consumedUnits: number;
  readonly reservationCostUnits: number;
  readonly limitUnits: number;
  readonly resetAtEpochMilliseconds: number;
}

/**
 * Production stores MUST reserve atomically across replicas. A duplicate key
 * must bind the original amount and must not consume budget twice.
 */
export interface CostLimitStore {
  reserve(request: CostStoreRequest): Promise<CostStoreResult>;
}

export interface CostLimiterOptions {
  readonly now?: () => number;
}

export class CostLimiter {
  readonly #now: () => number;
  readonly #config: CostPolicyConfig;
  readonly #store: CostLimitStore;

  public constructor(
    config: CostPolicyConfig,
    store: CostLimitStore,
    options: CostLimiterOptions = {},
  ) {
    if (!store || typeof store.reserve !== "function") {
      throw configurationError("A durable cost-limit store is required.");
    }
    this.#config = config;
    this.#store = store;
    this.#now = options.now ?? Date.now;
  }

  /** Reserve spend before dispatching any credit-consuming provider write. */
  public async reserve(input: CostReservation): Promise<CostStoreResult> {
    validateIdentity(input.userId, "user ID");
    validateOpaqueId(input.requestId, "request ID", 256);
    validateOpaqueId(input.reservationKey, "reservation key", 256);
    if (!Number.isSafeInteger(input.costUnits) || input.costUnits <= 0) {
      throw invalidCost();
    }
    if (input.costUnits > this.#config.maxRequestCostUnits) {
      throw new AppError("COST_LIMIT_EXCEEDED", {
        status: 422,
        message: "The quoted request exceeds the configured per-request cost limit.",
        details: { max_cost_units: this.#config.maxRequestCostUnits },
      });
    }
    const result = await this.#store.reserve({
      ...input,
      limitUnits: this.#config.maxUserCostUnitsPerWindow,
      windowSeconds: this.#config.windowSeconds,
      nowEpochMilliseconds: this.#now(),
    });
    validateStoreResult(
      result,
      input.costUnits,
      this.#config.maxUserCostUnitsPerWindow,
    );
    if (!result.accepted) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((result.resetAtEpochMilliseconds - this.#now()) / 1_000),
      );
      throw new AppError("COST_LIMIT_EXCEEDED", {
        status: 429,
        message: "The account has reached its cost limit for this period.",
        recoverable: true,
        details: { retry_after_seconds: retryAfterSeconds },
      });
    }
    return result;
  }
}

interface MemoryBucket {
  consumedUnits: number;
  readonly reservations: Map<string, number>;
  readonly resetAtEpochMilliseconds: number;
}

/** Single-process development/test store; construction fails in production. */
export class InMemoryCostLimitStore implements CostLimitStore {
  readonly #buckets = new Map<string, MemoryBucket>();
  readonly #maxBuckets: number;
  readonly #maxReservationsPerBucket: number;

  public constructor(
    environment: RuntimeEnvironment,
    maxBuckets = 10_000,
    maxReservationsPerBucket = 10_000,
  ) {
    if (environment === "production") {
      throw configurationError(
        "The in-memory cost-limit store is disabled in production.",
      );
    }
    if (
      !Number.isSafeInteger(maxBuckets) ||
      maxBuckets < 1 ||
      !Number.isSafeInteger(maxReservationsPerBucket) ||
      maxReservationsPerBucket < 1
    ) {
      throw configurationError("The in-memory cost-limit capacity is invalid.");
    }
    this.#maxBuckets = maxBuckets;
    this.#maxReservationsPerBucket = maxReservationsPerBucket;
  }

  public async reserve(request: CostStoreRequest): Promise<CostStoreResult> {
    const windowMilliseconds = request.windowSeconds * 1_000;
    const windowStart =
      Math.floor(request.nowEpochMilliseconds / windowMilliseconds) *
      windowMilliseconds;
    const resetAtEpochMilliseconds = windowStart + windowMilliseconds;
    this.removeExpired(request.nowEpochMilliseconds);
    const bucketKey = `${request.userId}\u0000${windowStart}`;
    let bucket = this.#buckets.get(bucketKey);
    if (!bucket) {
      if (this.#buckets.size >= this.#maxBuckets) throw storeUnavailable();
      bucket = {
        consumedUnits: 0,
        reservations: new Map(),
        resetAtEpochMilliseconds,
      };
      this.#buckets.set(bucketKey, bucket);
    }
    const previousCost = bucket.reservations.get(request.reservationKey);
    if (previousCost !== undefined) {
      if (previousCost !== request.costUnits) {
        throw new AppError("INVALID_INPUT", {
          status: 409,
          message: "The reservation key is already bound to a different cost.",
        });
      }
      return makeResult(true, true, bucket, request.limitUnits, previousCost);
    }
    if (bucket.reservations.size >= this.#maxReservationsPerBucket) {
      throw storeUnavailable();
    }
    if (bucket.consumedUnits + request.costUnits > request.limitUnits) {
      return makeResult(
        false,
        false,
        bucket,
        request.limitUnits,
        request.costUnits,
      );
    }
    bucket.consumedUnits += request.costUnits;
    bucket.reservations.set(request.reservationKey, request.costUnits);
    return makeResult(
      true,
      false,
      bucket,
      request.limitUnits,
      request.costUnits,
    );
  }

  private removeExpired(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAtEpochMilliseconds <= now) this.#buckets.delete(key);
    }
  }
}

function makeResult(
  accepted: boolean,
  duplicate: boolean,
  bucket: MemoryBucket,
  limitUnits: number,
  reservationCostUnits: number,
): CostStoreResult {
  return Object.freeze({
    accepted,
    duplicate,
    consumedUnits: bucket.consumedUnits,
    reservationCostUnits,
    limitUnits,
    resetAtEpochMilliseconds: bucket.resetAtEpochMilliseconds,
  });
}

function validateStoreResult(
  result: CostStoreResult,
  requestedCost: number,
  expectedLimit: number,
): void {
  if (
    !result ||
    !Number.isSafeInteger(result.consumedUnits) ||
    result.consumedUnits < 0 ||
    !Number.isSafeInteger(result.limitUnits) ||
    result.limitUnits !== expectedLimit ||
    !Number.isSafeInteger(result.reservationCostUnits) ||
    result.reservationCostUnits !== requestedCost ||
    (result.accepted && result.consumedUnits > result.limitUnits) ||
    !Number.isFinite(result.resetAtEpochMilliseconds)
  ) {
    throw new AppError("INTERNAL_ERROR", {
      status: 500,
      message: "Cost-limit accounting returned an invalid result.",
    });
  }
}

function validateIdentity(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new AppError("INVALID_INPUT", {
      status: 400,
      message: `The ${label} is invalid.`,
    });
  }
}

function validateOpaqueId(value: string, label: string, maximum: number): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new AppError("INVALID_INPUT", {
      status: 400,
      message: `The ${label} is invalid.`,
    });
  }
}

function invalidCost(): AppError {
  return new AppError("INVALID_INPUT", {
    status: 400,
    message: "The requested cost is invalid.",
  });
}

function storeUnavailable(): AppError {
  return new AppError("PROVIDER_UNAVAILABLE", {
    status: 503,
    message: "Cost-limit accounting is temporarily unavailable.",
    recoverable: true,
  });
}

function configurationError(message: string): AppError {
  return new AppError("CONFIG_INVALID", { status: 500, message });
}
