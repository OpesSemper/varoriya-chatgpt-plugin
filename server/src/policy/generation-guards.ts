import { AppError } from "../errors.js";
import type {
  AuthenticatedRequestContext,
  GenerationGuards,
  IdempotencyLease,
  QuoteBinding,
} from "../types/varoriya.js";
import type { IdempotencyPolicy } from "./idempotency.js";
import type { OwnershipPolicy } from "./ownership.js";
import type { QuoteValidationPolicy } from "./quote.js";
import type { ScopePolicy } from "./scope.js";
import { toToolBoundaryError } from "./tool-boundary-error.js";

export interface GenerationSecurityGuardDependencies {
  readonly scopes: ScopePolicy;
  readonly quotes: QuoteValidationPolicy;
  readonly idempotency: IdempotencyPolicy;
  readonly ownership: OwnershipPolicy;
}

/** Concrete composition adapter consumed by the future MCP tool registry. */
export class GenerationSecurityGuards implements GenerationGuards {
  readonly #dependencies: GenerationSecurityGuardDependencies;

  public constructor(dependencies: GenerationSecurityGuardDependencies) {
    if (
      !dependencies?.scopes ||
      typeof dependencies.scopes.require !== "function" ||
      !dependencies.quotes ||
      typeof dependencies.quotes.validate !== "function" ||
      !dependencies.idempotency ||
      typeof dependencies.idempotency.acquire !== "function" ||
      !dependencies.ownership ||
      typeof dependencies.ownership.assertJobOwner !== "function" ||
      typeof dependencies.ownership.assertFileOwners !== "function"
    ) {
      throw new AppError("CONFIG_INVALID", {
        status: 500,
        message: "Generation security guards are not fully configured.",
      });
    }
    this.#dependencies = dependencies;
  }

  public requireScope(
    context: AuthenticatedRequestContext,
    scope: string,
  ): void {
    try {
      this.#dependencies.scopes.require(context, scope);
    } catch (error) {
      throw toToolBoundaryError(context.requestId, error);
    }
  }

  public async validateQuote(
    context: AuthenticatedRequestContext,
    token: string,
    expected: Pick<QuoteBinding, "model" | "kind" | "parameters">,
  ): Promise<QuoteBinding> {
    try {
      return await this.#dependencies.quotes.validate(context, token, expected);
    } catch (error) {
      throw toToolBoundaryError(context.requestId, error);
    }
  }

  public async acquireIdempotency(
    context: AuthenticatedRequestContext,
    key: string,
  ): Promise<IdempotencyLease> {
    try {
      return await this.#dependencies.idempotency.acquire(context, key);
    } catch (error) {
      throw toToolBoundaryError(context.requestId, error);
    }
  }

  public async assertJobOwnership(
    context: AuthenticatedRequestContext,
    jobId: string,
  ): Promise<void> {
    try {
      await this.#dependencies.ownership.assertJobOwner(context, jobId);
    } catch (error) {
      throw toToolBoundaryError(context.requestId, error);
    }
  }

  public async assertFileOwnership(
    context: AuthenticatedRequestContext,
    fileIds: readonly string[],
  ): Promise<void> {
    try {
      await this.#dependencies.ownership.assertFileOwners(context, fileIds);
    } catch (error) {
      throw toToolBoundaryError(context.requestId, error);
    }
  }
}
