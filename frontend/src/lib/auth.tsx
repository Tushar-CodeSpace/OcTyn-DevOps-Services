import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, getToken, setToken } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  reload: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  const reload = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiFetch<User>("/auth/me");
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors during logout
    } finally {
      setToken(null);
      setUser(null);
    }
  }, []);

  const roleStr = user?.role ? String(user.role).toLowerCase() : "";
  const isSuperAdmin = roleStr === "super_admin";
  const isAdmin = isSuperAdmin || roleStr === "admin";

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const savedTheme = localStorage.getItem("user_theme");
    if (!savedTheme && isSuperAdmin) {
      root.classList.add("tui-theme", "dark");
      body.classList.add("tui-theme", "dark");
    }
  }, [isSuperAdmin]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      isAdmin,
      isSuperAdmin,
      reload,
      logout,
    }),
    [user, loading, isAdmin, isSuperAdmin, reload, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
