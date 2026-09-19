import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch, getToken, getRefreshToken, setTokens, clearTokens } from "@/lib/api";
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

function getTokenExpiry(): number | null {
  try {
    const token = getToken();
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performRefresh = useCallback(async () => {
    const refresh = getRefreshToken();
    if (!refresh) {
      clearTokens();
      setUser(null);
      return;
    }
    try {
      const resp = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!resp.ok) throw new Error("Refresh failed");
      const data: { access_token: string; refresh_token: string; expires_at: string } = await resp.json();
      setTokens(data.access_token, data.refresh_token);
      const exp = getTokenExpiry();
      if (exp) {
        const ttl = exp - Date.now();
        if (ttl > 0) {
          refreshTimerRef.current = setTimeout(() => {
            void performRefresh();
          }, Math.max(ttl - 2 * 60 * 1000, 1000));
        }
      }
    } catch {
      clearTokens();
      setUser(null);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const exp = getTokenExpiry();
    if (!exp) return;
    const ttl = exp - Date.now();
    if (ttl <= 0) return;
    refreshTimerRef.current = setTimeout(() => {
      void performRefresh();
    }, Math.max(ttl - 2 * 60 * 1000, 1000));
  }, [performRefresh]);

  const reload = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiFetch<User>("/auth/me");
      setUser(me);
      scheduleRefresh();
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [scheduleRefresh]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Ignore network errors during logout
    } finally {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      clearTokens();
      setUser(null);
    }
  }, []);

  const roleStr = user?.role ? String(user.role).toLowerCase() : "";
  const isSuperAdmin = roleStr === "super_admin";
  const isAdmin = isSuperAdmin || roleStr === "admin";

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.remove("tui-theme");
    root.classList.add("dark");
    body.classList.remove("tui-theme");
    body.classList.add("dark");
  }, []);

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
    throw new Error("useAuth must be within AuthProvider");
  }
  return ctx;
}
