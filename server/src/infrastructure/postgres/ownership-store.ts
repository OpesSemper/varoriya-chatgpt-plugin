import { AppError } from "../../errors.js";
import type { OwnershipStore } from "../../policy/ownership.js";
import type { PostgresDatabase, SqlQueryExecutor } from "./client.js";
import { assertPostgresDatabase } from "./client.js";
import {
  failClosed,
  onlyRow,
  validateOpaqueId,
  validateSubject,
} from "./support.js";

interface OwnerRow {
  readonly resource_id: string;
  readonly subject: string;
}

const INSERT_OWNER = `
/* varoriya-security:ownership-insert */
INSERT INTO varoriya_security.resource_owners (resource_type, resource_id, subject)
VALUES ($1, $2, $3)
ON CONFLICT (resource_type, resource_id) DO NOTHING`;

const FIND_OWNER = `
/* varoriya-security:ownership-find */
SELECT resource_id, subject
FROM varoriya_security.resource_owners
WHERE resource_type = $1 AND resource_id = $2`;

const FIND_OWNERS = `
/* varoriya-security:ownership-find-many */
SELECT resource_id, subject
FROM varoriya_security.resource_owners
WHERE resource_type = $1 AND resource_id = ANY($2::text[])`;

/** Immutable ownership bindings. Existing resources can never be reassigned. */
export class PostgresOwnershipStore implements OwnershipStore {
  readonly #database: PostgresDatabase;

  public constructor(database: PostgresDatabase) {
    this.#database = assertPostgresDatabase(database);
  }

  public bindJob(jobId: string, subject: string): Promise<void> {
    return this.bind("job", jobId, subject);
  }

  public bindFile(fileId: string, subject: string): Promise<void> {
    return this.bind("file", fileId, subject);
  }

  public async getJobOwner(jobId: string): Promise<string | null> {
    validateOpaqueId(jobId, "job identifier");
    return failClosed(async () => {
      const result = await this.#database.query<OwnerRow>(FIND_OWNER, ["job", jobId]);
      if (result.rows.length === 0) return null;
      return onlyRow(result.rows).subject;
    });
  }

  public async getFileOwners(
    fileIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (fileIds.length < 1 || fileIds.length > 16) {
      throw new TypeError("One to sixteen file identifiers are required.");
    }
    fileIds.forEach((id) => validateOpaqueId(id, "file identifier"));
    return failClosed(async () => {
      const result = await this.#database.query<OwnerRow>(FIND_OWNERS, [
        "file",
        fileIds,
      ]);
      return new Map(result.rows.map((row) => [row.resource_id, row.subject]));
    });
  }

  private async bind(
    type: "job" | "file",
    id: string,
    subject: string,
  ): Promise<void> {
    validateOpaqueId(id, `${type} identifier`);
    validateSubject(subject);
    await failClosed(() =>
      this.#database.transaction(async (transaction) => {
        await transaction.query(INSERT_OWNER, [type, id, subject]);
        const current = onlyRow(
          (await transaction.query<OwnerRow>(FIND_OWNER, [type, id])).rows,
        );
        if (current.subject !== subject) {
          throw new AppError("RESOURCE_FORBIDDEN", {
            status: 409,
            message: "The resource is already bound to a different account.",
          });
        }
      }, { isolationLevel: "read committed" }),
    );
  }
}

export async function checkOwnershipStore(
  transaction: SqlQueryExecutor,
): Promise<void> {
  await transaction.query("SELECT 1 FROM varoriya_security.resource_owners LIMIT 1");
}
