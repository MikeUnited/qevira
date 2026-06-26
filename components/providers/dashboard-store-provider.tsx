"use client";

import * as React from "react";

export type DashboardContextValue = {
  isSellingMode: boolean;
  toggleSellingMode: () => void;
};

export const DashboardContext =
  React.createContext<DashboardContextValue | null>(null);

export function DashboardStoreProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isSellingMode, setIsSellingMode] = React.useState(false);

  const toggleSellingMode = React.useCallback(() => {
    setIsSellingMode((prev) => !prev);
  }, []);

  const value = React.useMemo(
    () => ({ isSellingMode, toggleSellingMode }),
    [isSellingMode, toggleSellingMode]
  );

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboardStore(): DashboardContextValue {
  const ctx = React.useContext(DashboardContext);
  if (!ctx) {
    throw new Error(
      "useDashboardStore must be used within a DashboardStoreProvider"
    );
  }
  return ctx;
}
