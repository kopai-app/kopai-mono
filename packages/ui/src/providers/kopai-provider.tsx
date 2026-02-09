import { createContext, useContext, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

interface KopaiSDKProviderProps {
  client: KopaiClient;
  children: ReactNode;
}

export function KopaiSDKProvider({ client, children }: KopaiSDKProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <KopaiSDKContext.Provider value={{ client }}>
        {children}
      </KopaiSDKContext.Provider>
    </QueryClientProvider>
  );
}

export function useKopaiSDK(): KopaiClient {
  const ctx = useContext(KopaiSDKContext);
  if (!ctx) {
    throw new Error("useKopaiSDK must be used within KopaiSDKProvider");
  }
  return ctx.client;
}
