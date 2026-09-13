import type { CostPolicyConfig } from "../../config.js";
import type { CostStoreRequest } from "../../policy/cost-limit.js";
import type {
  QuoteVerifier,
  VerifiedQuoteClaims,
} from "../../policy/quote.js";
import type { GenerationQuote } from "../../types/varoriya.js";
import {
  canonicalJson,
  invalidQuote,
  moneyToMicros,
  quoteDigest,
} from "../security-values.js";
import type { PostgresDatabase } from "./client.js";
import { assertPostgresDatabase } from "./client.js";
import { PostgresCostLimitStore } from "./cost-limit-store.js";
import {
  failClosed,
  onlyRow,
  parseSafeInteger,
  validateEpochMilliseconds,
  validateOpaqueId,
  validateSubject,
} from "./support.js";

interface QuoteRow {
  readonly token_hash: string;
  readonly quote_id: string;
  readonly subject: string;
  readonly model: string;
  readonly kind: "image" | "video" | "audio";
  readonly parameters_payload: unknown;
  readonly expires_at_epoch_seconds: string | number;
  readonly cost_amount: string;
  readonly cost_currency: string;
  readonly cost_units: string | number;
}

const INSERT_QUOTE = `
/* varoriya-security:quote-insert */
INSERT INTO varoriya_security.quote_records (
  token_hash, quote_id, subject, model, kind, parameters_payload,
  expires_at, cost_amount, cost_currency, cost_units
) VALUES (
  $1, $2, $3, $4, $5, $6::jsonb,
  to_timestamp($7), $8, $9, $10
)
ON CONFLICT (token_hash) DO NOTHING`;

const FIND_QUOTE = `
/* varoriya-security:quote-find */
SELECT
  token_hash, quote_id, subject, model, kind, parameters_payload,
  EXTRACT(EPOCH FROM expires_at)::bigint AS expires_at_epoch_seconds,
  cost_amount, cost_currency, cost_units
FROM varoriya_security.quote_records
WHERE token_hash = $1`;

const LOCK_QUOTE = `${FIND_QUOTE} FOR UPDATE`;

/** Stores only a SHA-256 token digest and atomically reserves quoted spend. */
export class PostgresQuoteStore implements QuoteVerifier {
  readonly #database: PostgresDatabase;
  readonly #costStore: PostgresCostLimitStore;
  readonly #costConfig: CostPolicyConfig;

  public constructor(
    database: PostgresDatabase,
    costStore: PostgresCostLimitStore,
    costConfig: CostPolicyConfig,
  ) {
    this.#database = assertPostgresDatabase(database);
    this.#costStore = costStore;
    this.#costConfig = costConfig;
  }

  public async record(
    subject: string,
    quote: GenerationQuote,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    validateSubject(subject);
    validateQuoteToken(quote.quote_token);
    const tokenHash = quoteDigest(quote.quote_token);
    const quoteId = tokenHash;
    validateOpaqueId(quoteId, "quote identifier");
    const canonicalParameters = canonicalJson(parameters) as Readonly<
      Record<string, unknown>
    >;
    const returnedParameters = quote.parameters
      ? canonicalJson(quote.parameters)
      : canonicalParameters;
    if (JSON.stringify(canonicalParameters) !== JSON.stringify(returnedParameters)) {
      throw invalidQuote();
    }
    const expiresAtEpochSeconds = Math.floor(Date.parse(quote.expires_at) / 1_000);
    validateEpochMilliseconds(expiresAtEpochSeconds * 1_000, "Quote expiry");
    const costUnits = moneyToMicros(
      quote.estimated_cost,
      this.#costConfig.currency,
    );
    await failClosed(() =>
      this.#database.transaction(async (transaction) => {
        await transaction.query(INSERT_QUOTE, [
          tokenHash,
          quoteId,
          subject,
          quote.model,
          quote.kind,
          JSON.stringify(canonicalParameters),
          expiresAtEpochSeconds,
          quote.estimated_cost.amount,
          quote.estimated_cost.currency,
          costUnits,
        ]);
        const stored = onlyRow(
          (await transaction.query<QuoteRow>(FIND_QUOTE, [tokenHash])).rows,
        );
        assertSameQuote(stored, {
          tokenHash,
          quoteId,
          subject,
          quote,
          parameters: canonicalParameters,
          expiresAtEpochSeconds,
          costUnits,
        });
      }, { isolationLevel: "read committed" }),
    );
  }

  public async verify(
    token: string,
    nowEpochSeconds: number,
    reservation: {
      readonly requestId: string;
      readonly reservationKey: string;
    },
  ): Promise<VerifiedQuoteClaims> {
    validateQuoteToken(token);
    validateOpaqueId(reservation.requestId, "request identifier");
    validateOpaqueId(reservation.reservationKey, "reservation key", 128);
    const tokenHash = quoteDigest(token);
    validateEpochMilliseconds(nowEpochSeconds * 1_000, "Quote verification time");
    return failClosed(() =>
      this.#database.transaction(async (transaction) => {
        const result = await transaction.query<QuoteRow>(LOCK_QUOTE, [tokenHash]);
        if (result.rows.length !== 1) throw invalidQuote();
        const row = onlyRow(result.rows);
        const expiresAtEpochSeconds = parseSafeInteger(
          row.expires_at_epoch_seconds,
          "quote expiry",
          1,
        );
        if (expiresAtEpochSeconds <= nowEpochSeconds) throw invalidQuote();
        const costUnits = parseSafeInteger(row.cost_units, "quote cost");
        if (costUnits > this.#costConfig.maxRequestCostUnits) {
          throw invalidQuote();
        }
        if (costUnits > 0) {
          const request: CostStoreRequest = {
            userId: row.subject,
            requestId: reservation.requestId,
            reservationKey: `${row.quote_id}:${reservation.reservationKey}`,
            costUnits,
            limitUnits: this.#costConfig.maxUserCostUnitsPerWindow,
            windowSeconds: this.#costConfig.windowSeconds,
            nowEpochMilliseconds: nowEpochSeconds * 1_000,
          };
          const costReservation = await this.#costStore.reserveWithinTransaction(
            transaction,
            request,
          );
          if (!costReservation.accepted) throw invalidQuote();
        }
        return Object.freeze({
          quoteId: row.quote_id,
          subject: row.subject,
          model: row.model,
          kind: row.kind,
          parameters: canonicalJson(row.parameters_payload) as Readonly<
            Record<string, unknown>
          >,
          expiresAtEpochSeconds,
          maxCost: Object.freeze({
            amount: row.cost_amount,
            currency: row.cost_currency,
          }),
        });
      }, { isolationLevel: "serializable" }),
    );
  }
}

function validateQuoteToken(token: string): void {
  if (
    typeof token !== "string" ||
    token.length < 16 ||
    token.length > 4_096 ||
    /[\u0000-\u0020\u007f]/.test(token)
  ) {
    throw invalidQuote();
  }
}

function assertSameQuote(
  row: QuoteRow,
  expected: {
    readonly tokenHash: string;
    readonly quoteId: string;
    readonly subject: string;
    readonly quote: GenerationQuote;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly expiresAtEpochSeconds: number;
    readonly costUnits: number;
  },
): void {
  if (
    row.token_hash !== expected.tokenHash ||
    row.quote_id !== expected.quoteId ||
    row.subject !== expected.subject ||
    row.model !== expected.quote.model ||
    row.kind !== expected.quote.kind ||
    JSON.stringify(canonicalJson(row.parameters_payload)) !==
      JSON.stringify(expected.parameters) ||
    parseSafeInteger(row.expires_at_epoch_seconds, "quote expiry", 1) !==
      expected.expiresAtEpochSeconds ||
    row.cost_amount !== expected.quote.estimated_cost.amount ||
    row.cost_currency !== expected.quote.estimated_cost.currency ||
    parseSafeInteger(row.cost_units, "quote cost") !== expected.costUnits
  ) {
    throw invalidQuote();
  }
}
