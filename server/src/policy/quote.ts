import { AppError } from "../errors.js";
import type {
  AuthenticatedRequestContext,
  GenerationKind,
  Money,
  QuoteBinding,
} from "../types/varoriya.js";

export interface VerifiedQuoteClaims {
  readonly quoteId: string;
  readonly subject: string;
  readonly model: string;
  readonly kind: GenerationKind;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly expiresAtEpochSeconds: number;
  /** Signed/immutable upper bound used by cost policy and reconciliation. */
  readonly maxCost: Money;
}

/**
 * Production implementation MUST verify authenticity/integrity, issuer,
 * audience, algorithm, expiry, and immutable quote binding. Never decode-and-
 * trust a client token.
 */
export interface QuoteVerifier {
  verify(token: string, nowEpochSeconds: number): Promise<VerifiedQuoteClaims>;
}

export interface QuoteValidationPolicyOptions {
  readonly now?: () => number;
  readonly clockToleranceSeconds?: number;
}

export class QuoteValidationPolicy {
  readonly #now: () => number;
  readonly #clockToleranceSeconds: number;
  readonly #verifier: QuoteVerifier;

  public constructor(
    verifier: QuoteVerifier,
    options: QuoteValidationPolicyOptions = {},
  ) {
    if (!verifier || typeof verifier.verify !== "function") {
      throw configurationError("A quote verifier is required.");
    }
    this.#verifier = verifier;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.#clockToleranceSeconds = options.clockToleranceSeconds ?? 0;
    if (
      !Number.isInteger(this.#clockToleranceSeconds) ||
      this.#clockToleranceSeconds < 0 ||
      this.#clockToleranceSeconds > 60
    ) {
      throw configurationError("The quote clock tolerance is invalid.");
    }
  }

  public async validate(
    context: AuthenticatedRequestContext,
    token: string,
    expected: Pick<QuoteBinding, "model" | "kind" | "parameters">,
  ): Promise<QuoteBinding> {
    if (!validToken(token) || !validModel(expected.model) || !validKind(expected.kind)) {
      throw invalidQuote();
    }
    const now = this.#now();
    let claims: VerifiedQuoteClaims;
    try {
      claims = await this.#verifier.verify(token, now);
    } catch (cause) {
      throw new AppError("INVALID_QUOTE", {
        status: 400,
        message: "The quote is invalid or has expired. Request a new quote.",
        cause,
      });
    }
    if (
      !validOpaqueId(claims.quoteId) ||
      !validIdentity(claims.subject) ||
      claims.subject !== context.subject ||
      claims.model !== expected.model ||
      claims.kind !== expected.kind ||
      !sameJson(claims.parameters, expected.parameters) ||
      !Number.isSafeInteger(claims.expiresAtEpochSeconds) ||
      claims.expiresAtEpochSeconds <= now + this.#clockToleranceSeconds
    ) {
      throw invalidQuote();
    }
    validateMoney(claims.maxCost);
    return Object.freeze({
      subject: claims.subject,
      token,
      model: claims.model,
      kind: claims.kind,
      parameters: Object.freeze({ ...claims.parameters }),
      expiresAt: new Date(claims.expiresAtEpochSeconds * 1_000).toISOString(),
      maxCost: Object.freeze({ ...claims.maxCost }),
    });
  }
}

function sameJson(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  try {
    return stableJson(left) === stableJson(right);
  } catch {
    return false;
  }
}

function stableJson(value: unknown, depth = 0): string {
  if (depth > 6) throw invalidQuote();
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidQuote();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw invalidQuote();
    return `[${value.map((item) => stableJson(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 64) throw invalidQuote();
    return `{${entries
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item, depth + 1)}`)
      .join(",")}}`;
  }
  throw invalidQuote();
}

function validToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 4_096 &&
    !/[\u0000-\u0020\u007f]/.test(value)
  );
}

function validOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._:-]{1,256}$/.test(value)
  );
}

function validIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validModel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._-]{1,128}$/.test(value)
  );
}

function validKind(value: unknown): value is GenerationKind {
  return value === "image" || value === "video" || value === "audio";
}

function validateMoney(value: Money): void {
  if (
    !value ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value.amount) ||
    !/^[A-Z]{3}$/.test(value.currency)
  ) {
    throw invalidQuote();
  }
}

function invalidQuote(): AppError {
  return new AppError("INVALID_QUOTE", {
    status: 400,
    message: "The quote is invalid or has expired. Request a new quote.",
  });
}

function configurationError(message: string): AppError {
  return new AppError("CONFIG_INVALID", { status: 500, message });
}
