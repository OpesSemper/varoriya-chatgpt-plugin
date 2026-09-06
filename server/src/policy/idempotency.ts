import type { RuntimeEnvironment } from "../config.js";
import { AppError } from "../errors.js";
import type {
  AuthenticatedRequestContext,
  GenerationJob,
  IdempotencyLease,
} from "../types/varoriya.js";

export interface IdempotencyAcquireRequest {
  readonly subject: string;
  readonly key: string;
  readonly requestId: string;
  readonly nowEpochMilliseconds: number;
  readonly reservationTtlMilliseconds: number;
  readonly completedRetentionMilliseconds: number;
}

export type IdempotencyAcquireResult =
  | { readonly status: "acquired"; readonly leaseId: string }
  | { readonly status: "in-progress" }
  | { readonly status: "completed"; readonly job: GenerationJob };

/**
 * Production stores MUST atomically acquire `(subject,key)`, fence stale writers
 * with `leaseId`, and persist provider job/charge linkage durably before return.
 */
export interface IdempotencyStore {
  acquire(request: IdempotencyAcquireRequest): Promise<IdempotencyAcquireResult>;
  complete(
    subject: string,
    key: string,
    leaseId: string,
    job: GenerationJob,
    nowEpochMilliseconds: number,
  ): Promise<void>;
  abandonBeforeSubmission(
    subject: string,
    key: string,
    leaseId: string,
  ): Promise<void>;
}

export interface IdempotencyPolicyOptions {
  readonly now?: () => number;
  readonly reservationTtlMilliseconds?: number;
  readonly completedRetentionMilliseconds?: number;
}

export class IdempotencyPolicy {
  readonly #now: () => number;
  readonly #reservationTtlMilliseconds: number;
  readonly #completedRetentionMilliseconds: number;
  readonly #store: IdempotencyStore;

  public constructor(
    store: IdempotencyStore,
    options: IdempotencyPolicyOptions = {},
  ) {
    if (!store || typeof store.acquire !== "function") {
      throw configurationError();
    }
    this.#store = store;
    this.#now = options.now ?? Date.now;
    this.#reservationTtlMilliseconds =
      options.reservationTtlMilliseconds ?? 15 * 60 * 1_000;
    this.#completedRetentionMilliseconds =
      options.completedRetentionMilliseconds ?? 7 * 24 * 60 * 60 * 1_000;
    if (
      !Number.isSafeInteger(this.#reservationTtlMilliseconds) ||
      this.#reservationTtlMilliseconds < 10_000 ||
      !Number.isSafeInteger(this.#completedRetentionMilliseconds) ||
      this.#completedRetentionMilliseconds < this.#reservationTtlMilliseconds
    ) {
      throw configurationError();
    }
  }

  public async acquire(
    context: AuthenticatedRequestContext,
    key: string,
  ): Promise<IdempotencyLease> {
    validateIdentity(context.subject);
    validateOpaqueId(context.requestId, 256);
    if (key.length < 16) throw invalidKey();
    validateOpaqueId(key, 128);
    const result = await this.#store.acquire({
      subject: context.subject,
      key,
      requestId: context.requestId,
      nowEpochMilliseconds: this.#now(),
      reservationTtlMilliseconds: this.#reservationTtlMilliseconds,
      completedRetentionMilliseconds: this.#completedRetentionMilliseconds,
    });
    if (result.status === "completed") {
      return Object.freeze({
        replay: Object.freeze({ ...result.job }),
        complete: async (): Promise<void> => {
          throw storeFailure();
        },
      });
    }
    if (result.status === "in-progress") {
      throw new AppError("RATE_LIMITED", {
        status: 409,
        message: "A request with this idempotency key is already in progress.",
        recoverable: true,
      });
    }
    if (!validOpaqueId(result.leaseId, 256)) throw storeFailure();

    let settled = false;
    return {
      complete: async (job: GenerationJob): Promise<void> => {
        if (settled) throw storeFailure();
        await this.#store.complete(
          context.subject,
          key,
          result.leaseId,
          Object.freeze({ ...job }),
          this.#now(),
        );
        settled = true;
      },
      abandonBeforeSubmission: async (): Promise<void> => {
        if (settled) return;
        await this.#store.abandonBeforeSubmission(
          context.subject,
          key,
          result.leaseId,
        );
        settled = true;
      },
    };
  }
}

type MemoryRecord =
  | {
      readonly state: "reserved";
      readonly leaseId: string;
      readonly expiresAt: number;
      readonly completedRetentionMilliseconds: number;
    }
  | {
      readonly state: "completed";
      readonly job: GenerationJob;
      readonly expiresAt: number;
    };

/** Bounded single-process implementation for development/tests only. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #records = new Map<string, MemoryRecord>();
  #sequence = 0;
  readonly #maxRecords: number;

  public constructor(
    environment: RuntimeEnvironment,
    maxRecords = 25_000,
  ) {
    if (environment === "production") {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "The in-memory idempotency store is disabled in production.",
      });
    }
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
      throw configurationError();
    }
    this.#maxRecords = maxRecords;
  }

  public async acquire(
    request: IdempotencyAcquireRequest,
  ): Promise<IdempotencyAcquireResult> {
    this.removeExpired(request.nowEpochMilliseconds);
    const recordKey = storageKey(request.subject, request.key);
    const current = this.#records.get(recordKey);
    if (current?.state === "completed") {
      return { status: "completed", job: current.job };
    }
    if (current?.state === "reserved") return { status: "in-progress" };
    if (this.#records.size >= this.#maxRecords) throw storeFailure();
    this.#sequence = (this.#sequence + 1) % Number.MAX_SAFE_INTEGER;
    const leaseId = `dev-${request.nowEpochMilliseconds}-${this.#sequence}`;
    this.#records.set(recordKey, {
      state: "reserved",
      leaseId,
      expiresAt:
        request.nowEpochMilliseconds + request.reservationTtlMilliseconds,
      completedRetentionMilliseconds: request.completedRetentionMilliseconds,
    });
    return { status: "acquired", leaseId };
  }

  public async complete(
    subject: string,
    key: string,
    leaseId: string,
    job: GenerationJob,
    now: number,
  ): Promise<void> {
    const recordKey = storageKey(subject, key);
    const current = this.#records.get(recordKey);
    if (
      current?.state !== "reserved" ||
      current.leaseId !== leaseId ||
      current.expiresAt <= now
    ) {
      throw storeFailure();
    }
    this.#records.set(recordKey, {
      state: "completed",
      job: Object.freeze({ ...job }),
      expiresAt: now + current.completedRetentionMilliseconds,
    });
  }

  public async abandonBeforeSubmission(
    subject: string,
    key: string,
    leaseId: string,
  ): Promise<void> {
    const recordKey = storageKey(subject, key);
    const current = this.#records.get(recordKey);
    if (current?.state === "reserved" && current.leaseId === leaseId) {
      this.#records.delete(recordKey);
    }
  }

  private removeExpired(now: number): void {
    for (const [key, record] of this.#records) {
      if (record.expiresAt <= now) this.#records.delete(key);
    }
  }
}

function storageKey(subject: string, key: string): string {
  return `${subject}\u0000${key}`;
}

function validateIdentity(value: string): void {
  if (
    value.length < 1 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new AppError("INVALID_TOKEN", {
      status: 401,
      message: "The authenticated identity is invalid.",
    });
  }
}

function validOpaqueId(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function validateOpaqueId(value: string, maximum: number): void {
  if (!validOpaqueId(value, maximum)) throw invalidKey();
}

function invalidKey(): AppError {
  return new AppError("INVALID_INPUT", {
    status: 400,
    message: "The idempotency key is invalid.",
  });
}

function storeFailure(): AppError {
  return new AppError("PROVIDER_UNAVAILABLE", {
    status: 503,
    message: "Idempotency protection is temporarily unavailable.",
    recoverable: true,
  });
}

function configurationError(): AppError {
  return new AppError("CONFIG_INVALID", {
    status: 500,
    message: "Idempotency protection is not safely configured.",
  });
}
