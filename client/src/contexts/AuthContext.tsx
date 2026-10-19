/**
 * AuthContext — JWT auth with refresh token persistence.
 *
 * Storage strategy:
 *   - accessToken  → localStorage (short-lived, 15 min)
 *   - refreshToken → localStorage (long-lived, 7d)
 *   - user info    → localStorage (name, role, hospitalId)
 *
 * On mount: restore user from storage and attempt a proactive refresh to
 * verify the session is still valid before the user interacts.
 *
 * On "auth:logout" event (dispatched by api.ts on double-401): clears state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import type { AuthUser, LoginResponse, Role } from "../types/auth";

// ── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  ACCESS:  "egc_access",
  REFRESH: "egc_refresh",
  USER:    "egc_user",
} as const;

function saveSession(data: LoginResponse) {
  localStorage.setItem(KEYS.ACCESS,  data.accessToken);
  localStorage.setItem(KEYS.REFRESH, data.refreshToken);
  localStorage.setItem(KEYS.USER,    JSON.stringify(data.user));
}

function clearSession() {
  localStorage.removeItem(KEYS.ACCESS);
  localStorage.removeItem(KEYS.REFRESH);
  localStorage.removeItem(KEYS.USER);
}

function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEYS.USER);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

// ── Context shape ─────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  /** true while the initial session restore is in progress */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Convenience accessor */
  role: Role | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]     = useState<AuthUser | null>(loadUser);
  const [loading, setLoading] = useState(true);

  // ── Restore + verify session on mount ────────────────────────────────────
  useEffect(() => {
    const refresh = localStorage.getItem(KEYS.REFRESH);
    if (!refresh) { setLoading(false); return; }

    api
      .post<LoginResponse>("/auth/refresh", { refreshToken: refresh })
      .then(({ data }) => {
        // Server returned a new access token (and maybe a rotated refresh)
        localStorage.setItem(KEYS.ACCESS, data.accessToken);
        if (data.refreshToken) {
          localStorage.setItem(KEYS.REFRESH, data.refreshToken);
        }
        // Refresh endpoint may return user data; if not, keep stored user
        if (data.user) {
          localStorage.setItem(KEYS.USER, JSON.stringify(data.user));
          setUser(data.user);
        } else {
          setUser(loadUser());
        }
      })
      .catch(() => {
        // Refresh invalid → clear and force re-login
        clearSession();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Listen for forced logout from api.ts interceptor ─────────────────────
  useEffect(() => {
    const handler = () => {
      clearSession();
      setUser(null);
    };
    window.addEventListener("auth:logout", handler);
    return () => window.removeEventListener("auth:logout", handler);
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post<LoginResponse>("/auth/login", {
      username,
      password,
    });
    saveSession(data);
    setUser(data.user);
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    const refresh = localStorage.getItem(KEYS.REFRESH);
    try {
      if (refresh) {
        await api.post("/auth/logout", { refreshToken: refresh });
      }
    } finally {
      clearSession();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, role: user?.role ?? null }),
    [user, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
