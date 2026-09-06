import type { RuntimeEnvironment } from "../config.js";
import { AppError } from "../errors.js";
import type { AuthenticatedRequestContext } from "../types/varoriya.js";

/** Production implementation reads trusted, server-side ownership metadata. */
export interface OwnershipStore {
  getJobOwner(jobId: string): Promise<string | null>;
  getFileOwners(fileIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** Concrete default-deny adapter for jobs and uploaded files. */
export class OwnershipPolicy {
  readonly #store: OwnershipStore;

  public constructor(store: OwnershipStore) {
    if (
      !store ||
      typeof store.getJobOwner !== "function" ||
      typeof store.getFileOwners !== "function"
    ) {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "Resource ownership checks are not configured.",
      });
    }
    this.#store = store;
  }

  public async assertJobOwner(
    context: AuthenticatedRequestContext,
    jobId: string,
  ): Promise<void> {
    validateResourceId(jobId);
    assertOwner(context.subject, await this.#store.getJobOwner(jobId));
  }

  public async assertFileOwners(
    context: AuthenticatedRequestContext,
    fileIds: readonly string[],
  ): Promise<void> {
    if (
      fileIds.length < 1 ||
      fileIds.length > 16 ||
      new Set(fileIds).size !== fileIds.length
    ) {
      throw invalidResourceId();
    }
    fileIds.forEach(validateResourceId);
    const owners = await this.#store.getFileOwners(fileIds);
    for (const fileId of fileIds) {
      assertOwner(context.subject, owners.get(fileId));
    }
  }
}

/** Bounded local ownership registry; construction fails in production. */
export class InMemoryOwnershipStore implements OwnershipStore {
  readonly #jobOwners = new Map<string, string>();
  readonly #fileOwners = new Map<string, string>();
  readonly #maxRecords: number;

  public constructor(environment: RuntimeEnvironment, maxRecords = 25_000) {
    if (environment === "production") {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "The in-memory ownership store is disabled in production.",
      });
    }
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "The in-memory ownership capacity is invalid.",
      });
    }
    this.#maxRecords = maxRecords;
  }

  public bindJob(jobId: string, subject: string): void {
    validateResourceId(jobId);
    validateSubject(subject);
    this.bindOnce(this.#jobOwners, jobId, subject);
  }

  public bindFile(fileId: string, subject: string): void {
    validateResourceId(fileId);
    validateSubject(subject);
    this.bindOnce(this.#fileOwners, fileId, subject);
  }

  public async getJobOwner(jobId: string): Promise<string | null> {
    return this.#jobOwners.get(jobId) ?? null;
  }

  public async getFileOwners(
    fileIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const result = new Map<string, string>();
    for (const fileId of fileIds) {
      const owner = this.#fileOwners.get(fileId);
      if (owner) result.set(fileId, owner);
    }
    return result;
  }

  private bindOnce(
    target: Map<string, string>,
    id: string,
    subject: string,
  ): void {
    const existing = target.get(id);
    if (existing && existing !== subject) {
      throw new AppError("RESOURCE_FORBIDDEN", {
        status: 409,
        message: "The resource is already bound to a different account.",
      });
    }
    if (!existing && this.#jobOwners.size + this.#fileOwners.size >= this.#maxRecords) {
      throw new AppError("PROVIDER_UNAVAILABLE", {
        status: 503,
        message: "Resource ownership tracking is temporarily unavailable.",
        recoverable: true,
      });
    }
    target.set(id, subject);
  }
}

function assertOwner(subject: string, owner: string | null | undefined): void {
  if (!owner || owner !== subject) {
    throw new AppError("RESOURCE_FORBIDDEN", {
      status: 403,
      message: "The requested resource is not available to this account.",
    });
  }
}

function validateResourceId(value: string): void {
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(value)) throw invalidResourceId();
}

function validateSubject(value: string): void {
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

function invalidResourceId(): AppError {
  return new AppError("INVALID_INPUT", {
    status: 400,
    message: "The resource identifier is invalid.",
  });
}
