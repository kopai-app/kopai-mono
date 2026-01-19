import type { PathLike } from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

type DatabaseSyncParams = ConstructorParameters<typeof DatabaseSync>;

export async function initializeDatabase(
  path: PathLike,
  opts: DatabaseSyncParams[1]
) {
  const database = new DatabaseSync(path, opts);
  const openetelemetryTablesSchemaDdl = await readFile(
    "./sqlite-opentelemetry-ddl.sql",
    {
      encoding: "utf8",
    }
  );

  database.exec(openetelemetryTablesSchemaDdl);

  return database;
}
