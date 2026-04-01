import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RoleId } from "./roles";

export type SessionUser = {
  id: string;
  name: string;
  /** اسم الدخول — للعرض عند فشل ترميز DisplayName من القاعدة */
  login?: string;
  role: RoleId;
};

type AuthContextValue = {
  user: SessionUser | null;
  login: (u: SessionUser) => void;
  logout: () => void;
};

const STORAGE_KEY = "mat3am_session_v2";

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStored(): SessionUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SessionUser;
    if (!p?.id || !p?.role) return null;
    return p;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => loadStored());

  const login = useCallback((u: SessionUser) => {
    setUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({ user, login, logout }),
    [user, login, logout]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
