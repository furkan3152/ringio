"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** A shared counter; bumping it makes every chain query refetch after a transaction. */
type DataVersion = { version: number; bump(): void };

const DataVersionContext = createContext<DataVersion>({ version: 0, bump: () => undefined });

export function DataVersionProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((current) => current + 1), []);
  const value = useMemo(() => ({ version, bump }), [version, bump]);
  return <DataVersionContext.Provider value={value}>{children}</DataVersionContext.Provider>;
}

export function useDataVersion(): DataVersion {
  return useContext(DataVersionContext);
}
