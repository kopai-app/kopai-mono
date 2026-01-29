import { createContext, useContext, type ReactNode } from "react";
import type { KopaiClient } from "@kopai/sdk";

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
