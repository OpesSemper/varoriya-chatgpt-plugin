import { Pool, type PoolClient } from "pg";

import type {
  PostgresDatabase,
  PostgresTransactionOptions,
  SqlParameter,
  SqlQueryExecutor,
  SqlQueryResult,
} from "./client.js";

export interface NodePostgresDatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly statementTimeoutMs?: number;
}

/** Maintained node-postgres pool adapter with fenced transactions. */
export class NodePostgresDatabase implements PostgresDatabase {
  readonly #pool: Pool;

  public constructor(options: NodePostgresDatabaseOptions) {
    if (!safeConnectionString(options.connectionString)) {
      throw new TypeError("A PostgreSQL connection string is required.");
    }
    this.#pool = new Pool({
      connectionString: options.connectionString,
      max: boundedInteger(options.maxConnections, 10, 1, 100),
      connectionTimeoutMillis: boundedInteger(
        options.connectionTimeoutMs,
        5_000,
        100,
        60_000,
      ),
      idleTimeoutMillis: boundedInteger(
        options.idleTimeoutMs,
        30_000,
        1_000,
        600_000,
      ),
      statement_timeout: boundedInteger(
        options.statementTimeoutMs,
        10_000,
        100,
        120_000,
      ),
      application_name: "varoriya-mcp-gateway",
    });
  }

  public async query<Row extends object = Record<string, unknown>>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<SqlQueryResult<Row>> {
    return execute<Row>(this.#pool, text, parameters);
  }

  public async transaction<T>(
    operation: (transaction: SqlQueryExecutor) => Promise<T>,
    options: PostgresTransactionOptions = {},
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query(beginStatement(options.isolationLevel));
      const transaction: SqlQueryExecutor = Object.freeze({
        query: <Row extends object = Record<string, unknown>>(
          text: string,
          parameters: readonly SqlParameter[] = [],
        ) => execute<Row>(client, text, parameters),
      });
      const value = await operation(transaction);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async check(): Promise<void> {
    const result = await this.#pool.query("SELECT 1 AS ready");
    if (result.rows[0]?.ready !== 1) throw new Error("Database is not ready.");
  }

  public async close(): Promise<void> {
    await this.#pool.end();
  }
}

async function execute<Row extends object>(
  executor: Pick<PoolClient, "query">,
  text: string,
  parameters: readonly SqlParameter[],
): Promise<SqlQueryResult<Row>> {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new TypeError("SQL text is required.");
  }
  const result = await executor.query<Row>(text, [...parameters]);
  return Object.freeze({
    rows: Object.freeze(result.rows),
    rowCount: result.rowCount,
  });
}

function beginStatement(
  isolation: PostgresTransactionOptions["isolationLevel"],
): string {
  switch (isolation) {
    case "serializable":
      return "BEGIN ISOLATION LEVEL SERIALIZABLE";
    case "repeatable read":
      return "BEGIN ISOLATION LEVEL REPEATABLE READ";
    case "read committed":
    case undefined:
      return "BEGIN ISOLATION LEVEL READ COMMITTED";
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new TypeError("PostgreSQL pool configuration is invalid.");
  }
  return resolved;
}

function safeConnectionString(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      parsed.hostname.length > 0 &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}
