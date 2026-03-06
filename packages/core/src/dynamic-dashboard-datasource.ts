import { z } from "zod/v4";

/**
 * https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
 */
export const regexSemverNumberedGroups =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const semverSchema = z
  .string()
  .regex(regexSemverNumberedGroups)
  .brand<"ZodSemver">();

export const dashboardSchema = z.object({
  name: z.string(),
  id: z.string(),
  createdAt: z.iso.datetime(),
  metadata: z.record(z.string(), z.unknown()),
  uiTreeVersion: semverSchema,
  uiTree: z
    .looseObject({})
    .describe(
      "free-form object representing a uiTree to be rendered by @kopai/ui"
    ),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

export const createDashboardParams = z.object({
  name: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  uiTreeVersion: semverSchema,
  uiTree: z
    .looseObject({})
    .describe(
      "free-form object representing a uiTree to be rendered by @kopai/ui"
    ),
});

export const searchDashboardsFilter = z.object({
  name: z.string().optional(),
  createdAtMin: z.iso.datetime().optional(),
  createdAtMax: z.iso.datetime().optional(),
  uiTreeVersion: semverSchema.optional(),
  uiTreeVersionCompatible: semverSchema.optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  limit: z.number().int().min(1).max(1000).optional().default(100),
  cursor: z.string().optional(),
  sortOrder: z.enum(["ASC", "DESC"]).optional().default("DESC"),
});

export type SearchDashboardsFilter = z.infer<typeof searchDashboardsFilter>;

export interface DynamicDashboardDatasource {
  getDashboard(options: {
    id: string;
    requestContext?: unknown;
  }): Promise<Dashboard>;

  createDashboard(
    options: z.infer<typeof createDashboardParams> & {
      requestContext?: unknown;
    }
  ): Promise<Dashboard>;

  searchDashboards(
    filter: SearchDashboardsFilter & { requestContext?: unknown }
  ): Promise<{ data: Dashboard[]; nextCursor: string | null }>;
}
