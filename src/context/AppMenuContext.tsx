import { createContext, useContext } from "react";

type AppMenuContextValue = {
  openAppMenu: () => void;
  closeAppMenu: () => void;
};

const AppMenuContext = createContext<AppMenuContextValue | null>(null);

export function AppMenuProvider({ value, children }: { value: AppMenuContextValue; children: React.ReactNode }) {
  return <AppMenuContext.Provider value={value}>{children}</AppMenuContext.Provider>;
}

/** فتح قائمة التطبيق الرئيسية (من AppShell) */
export function useAppMenu(): AppMenuContextValue | null {
  return useContext(AppMenuContext);
}
