import { observabilityCatalog } from "./observability-catalog.js";
import { z } from "zod";

type UiTree = z.infer<typeof observabilityCatalog.uiTreeSchema>;

export type DashboardId = string;
export type UiTreeId = string;
export type OwnerId = string;

export interface DashboardMeta {
  dashboardId: DashboardId;
  uiTreeId: UiTreeId;
  name: string;
  ownerId: OwnerId;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VersionMeta {
  uiTreeId: UiTreeId;
  createdAt: string;
}

export interface DashboardWriteDatasource {
  createDashboard(
    uiTree: UiTree,
    name: string,
    ownerId: OwnerId
  ): Promise<DashboardMeta>;

  // uiTrees are immutable, creates new one with ref to previous
  updateDashboard(
    dashboardId: DashboardId,
    uiTree: UiTree,
    pinned?: boolean
  ): Promise<DashboardMeta>;

  deleteDashboard(dashboardId: DashboardId): Promise<void>;

  // Creates new uiTree copying content from specified version
  restoreVersion(
    dashboardId: DashboardId,
    uiTreeId: UiTreeId
  ): Promise<DashboardMeta>;
}

export interface DashboardReadDatasource {
  searchDashboards(params: {
    limit: number;
    cursor?: string;
    pinned?: boolean;
    ownerId?: OwnerId;
  }): Promise<{
    dashboards: (DashboardMeta & { uiTree: UiTree })[];
    nextCursor?: string;
  }>;

  getDashboard(
    dashboardId: DashboardId
  ): Promise<DashboardMeta & { uiTree: UiTree }>;

  listVersions(params: {
    dashboardId: DashboardId;
    limit: number;
    cursor?: string;
  }): Promise<{
    versions: VersionMeta[];
    nextCursor?: string;
  }>;

  getDashboardAtVersion(uiTreeId: UiTreeId): Promise<{
    uiTree: UiTree;
    createdAt: string;
  }>;
}
