import { createContext, useContext, type ReactNode } from "react";
import type { KopaiClient as SDKClient } from "@kopai/sdk";

export type KopaiClient = Pick<
  SDKClient,
  | "searchTracesPage"
  | "searchLogsPage"
  | "searchMetricsPage"
  | "getTrace"
  | "discoverMetrics"
>;

interface KopaiSDKContextValue {
  client: KopaiClient;
}

const KopaiSDKContext = createContext<KopaiSDKContextValue | null>(null);

interface KopaiSDKProviderProps {
  client: KopaiClient;
  children: ReactNode;
}

export function KopaiSDKProvider({ client, children }: KopaiSDKProviderProps) {
  return (
    <KopaiSDKContext.Provider value={{ client }}>
      {children}
    </KopaiSDKContext.Provider>
  );
}

export function useKopaiSDK(): KopaiClient {
  const ctx = useContext(KopaiSDKContext);
  if (!ctx) {
    throw new Error("useKopaiSDK must be used within KopaiSDKProvider");
  }
  return ctx.client;
}
