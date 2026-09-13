/**
 * Dependency-free PostgreSQL port. The application entrypoint must adapt a
 * maintained PostgreSQL driver/pool to this interface and must not expose raw
 * credentials through errors or logs.
 */
export type SqlParameter =
  | string
  | number
  | boolean
  | null
  | Date
  | readonly string[]
  | readonly number[];

export interface SqlQueryResult<Row extends object = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

export interface SqlQueryExecutor {
  query<Row extends object = Record<string, unknown>>(
    text: string,
    parameters?: readonly SqlParameter[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface PostgresTransactionOptions {
  readonly isolationLevel?: "read committed" | "repeatable read" | "serializable";
}

/**
 * `transaction` MUST use one checked-out connection, issue BEGIN before the
 * callback, COMMIT only after it resolves, and ROLLBACK on every rejection.
 */
export interface PostgresDatabase extends SqlQueryExecutor {
  transaction<T>(
    operation: (transaction: SqlQueryExecutor) => Promise<T>,
    options?: PostgresTransactionOptions,
  ): Promise<T>;
}

export function assertPostgresDatabase(
  database: PostgresDatabase,
): PostgresDatabase {
  if (
    !database ||
    typeof database.query !== "function" ||
    typeof database.transaction !== "function"
  ) {
    throw new TypeError("A transactional PostgreSQL database adapter is required.");
  }
  return database;
}
