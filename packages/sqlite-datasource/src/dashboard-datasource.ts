import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  DummyDriver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  sql as kyselySql,
} from "kysely";

import { type dashboardDatasource } from "@kopai/core";
import { SqliteDatasourceQueryError } from "./sqlite-datasource-error.js";
import type { DB } from "./db-types.js";

const queryBuilder = new Kysely<DB>({
  dialect: {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  },
});

function extractMajor(semver: string): number {
  const match = semver.match(/^(\d+)\./);
  if (!match) {
    throw new SqliteDatasourceQueryError(`Invalid semver string: "${semver}"`);
  }
  return parseInt(match[1]!, 10);
}

function mapRowToDashboard(
  row: Record<string, unknown>
): dashboardDatasource.Dashboard {
  return {
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    metadata: JSON.parse((row.metadata as string) ?? "{}"),
    uiTreeVersion:
      row.ui_tree_version as dashboardDatasource.Dashboard["uiTreeVersion"],
    uiTree: JSON.parse((row.ui_tree as string) ?? "{}"),
  };
}

export class DashboardDbDatasource
  implements dashboardDatasource.DynamicDashboardDatasource
{
  constructor(private sqliteConnection: DatabaseSync) {}

  async createDashboard(
    options: Parameters<
      dashboardDatasource.DynamicDashboardDatasource["createDashboard"]
    >[0]
  ): Promise<dashboardDatasource.Dashboard> {
    try {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const major = extractMajor(options.uiTreeVersion);

      const { sql, parameters } = queryBuilder
        .insertInto("dashboards")
        .values({
          id,
          name: options.name,
          created_at: createdAt,
          metadata: JSON.stringify(options.metadata ?? {}),
          ui_tree_version: options.uiTreeVersion,
          ui_tree_version_major: major,
          ui_tree: JSON.stringify(options.uiTree ?? {}),
        })
        .compile();

      this.sqliteConnection
        .prepare(sql)
        .run(...(parameters as (string | number | bigint | null)[]));

      return {
        id,
        name: options.name,
        createdAt,
        metadata: options.metadata ?? {},
        uiTreeVersion: options.uiTreeVersion,
        uiTree: options.uiTree ?? {},
      };
    } catch (error) {
      throw new SqliteDatasourceQueryError("Failed to create dashboard", {
        cause: error,
      });
    }
  }

  async getDashboard(options: {
    id: string;
    requestContext?: unknown;
  }): Promise<dashboardDatasource.Dashboard> {
    try {
      const { sql, parameters } = queryBuilder
        .selectFrom("dashboards")
        .selectAll()
        .where("id", "=", options.id)
        .compile();

      const rows = this.sqliteConnection
        .prepare(sql)
        .all(...(parameters as (string | number | bigint | null)[])) as Record<
        string,
        unknown
      >[];

      if (rows.length === 0) {
        throw new SqliteDatasourceQueryError(
          `Dashboard not found: ${options.id}`
        );
      }

      return mapRowToDashboard(rows[0]!);
    } catch (error) {
      if (error instanceof SqliteDatasourceQueryError) throw error;
      throw new SqliteDatasourceQueryError("Failed to get dashboard", {
        cause: error,
      });
    }
  }

  async searchDashboards(
    filter: dashboardDatasource.SearchDashboardsFilter & {
      requestContext?: unknown;
    }
  ): Promise<{
    data: dashboardDatasource.Dashboard[];
    nextCursor: string | null;
  }> {
    try {
      const limit = filter.limit ?? 100;
      const sortOrder = filter.sortOrder ?? "DESC";

      let query = queryBuilder.selectFrom("dashboards").selectAll();

      // Name substring match
      if (filter.name) {
        query = query.where("name", "like", `%${filter.name}%`);
      }

      // createdAt range
      if (filter.createdAtMin) {
        query = query.where("created_at", ">=", filter.createdAtMin);
      }
      if (filter.createdAtMax) {
        query = query.where("created_at", "<=", filter.createdAtMax);
      }

      // Exact uiTreeVersion match
      if (filter.uiTreeVersion) {
        query = query.where("ui_tree_version", "=", filter.uiTreeVersion);
      }

      // Semver compatible: match major version
      if (filter.uiTreeVersionCompatible) {
        const major = extractMajor(filter.uiTreeVersionCompatible);
        query = query.where("ui_tree_version_major", "=", major);
      }

      // Metadata flat key/value match via json_extract
      if (filter.metadata) {
        const validKey = /^[a-zA-Z0-9_-]+$/;
        for (const [key, value] of Object.entries(filter.metadata)) {
          if (!validKey.test(key)) {
            throw new SqliteDatasourceQueryError(
              `Invalid metadata key: ${key}. Keys must match /^[a-zA-Z0-9_-]+$/.`
            );
          }
          const jsonPath = `$."${key}"`;
          query = query.where(
            kyselySql`json_extract(metadata, ${kyselySql.lit(jsonPath)})`,
            "=",
            value
          );
        }
      }

      // Cursor pagination with id tiebreaker
      if (filter.cursor) {
        const sepIdx = filter.cursor.lastIndexOf("|");
        if (sepIdx === -1) {
          throw new SqliteDatasourceQueryError(
            `Invalid cursor format: expected "createdAt|id"`
          );
        }
        const cursorCreatedAt = filter.cursor.slice(0, sepIdx);
        const cursorId = filter.cursor.slice(sepIdx + 1);

        if (sortOrder === "DESC") {
          query = query.where((eb) =>
            eb.or([
              eb("created_at", "<", cursorCreatedAt),
              eb.and([
                eb("created_at", "=", cursorCreatedAt),
                eb("id", "<", cursorId),
              ]),
            ])
          );
        } else {
          query = query.where((eb) =>
            eb.or([
              eb("created_at", ">", cursorCreatedAt),
              eb.and([
                eb("created_at", "=", cursorCreatedAt),
                eb("id", ">", cursorId),
              ]),
            ])
          );
        }
      }

      // Sort and limit (+1 for next cursor detection)
      query = query
        .orderBy("created_at", sortOrder === "ASC" ? "asc" : "desc")
        .orderBy("id", sortOrder === "ASC" ? "asc" : "desc")
        .limit(limit + 1);

      // Execute
      const { sql, parameters } = query.compile();
      const rows = this.sqliteConnection
        .prepare(sql)
        .all(...(parameters as (string | number | bigint | null)[])) as Record<
        string,
        unknown
      >[];

      // Determine nextCursor
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = data[data.length - 1];
      const nextCursor =
        hasMore && lastRow ? `${lastRow.created_at}|${lastRow.id}` : null;

      return { data: data.map(mapRowToDashboard), nextCursor };
    } catch (error) {
      if (error instanceof SqliteDatasourceQueryError) throw error;
      throw new SqliteDatasourceQueryError("Failed to search dashboards", {
        cause: error,
      });
    }
  }
}
