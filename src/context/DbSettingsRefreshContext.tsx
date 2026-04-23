import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Ctx = { dbEpoch: number; bumpDbEpoch: () => void };

const DbSettingsRefreshContext = createContext<Ctx | null>(null);

export function DbSettingsRefreshProvider({ children }: { children: ReactNode }) {
  const [dbEpoch, setDbEpoch] = useState(0);
  const bumpDbEpoch = useCallback(() => setDbEpoch((n) => n + 1), []);
  return (
    <DbSettingsRefreshContext.Provider value={{ dbEpoch, bumpDbEpoch }}>{children}</DbSettingsRefreshContext.Provider>
  );
}

export function useDbSettingsRefresh(): Ctx {
  const v = useContext(DbSettingsRefreshContext);
  if (!v) throw new Error("useDbSettingsRefresh: provider missing");
  return v;
}

export function useDbEpoch(): number {
  return useContext(DbSettingsRefreshContext)?.dbEpoch ?? 0;
}
