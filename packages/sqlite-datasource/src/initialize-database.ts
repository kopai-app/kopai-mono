import type { PathLike } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ddl as openetelemetryTablesSchemaDdl } from "./sqlite-opentelemetry-ddl.js";

type DatabaseSyncParams = ConstructorParameters<typeof DatabaseSync>;

export function initializeDatabase(
  path: PathLike,
  opts?: DatabaseSyncParams[1]
) {
  const database = new DatabaseSync(path, opts ?? {});

  database.exec(openetelemetryTablesSchemaDdl);

  return database;
}
