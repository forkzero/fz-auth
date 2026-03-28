import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { AuthUser } from "../types.js";

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

export interface AuthProviderProps {
  children: ReactNode;
  /** BFF login endpoint (default: /auth/login) */
  loginUrl?: string;
  /** BFF logout endpoint (default: /auth/logout) */
  logoutUrl?: string;
  /** BFF session endpoint (default: /auth/session) */
  sessionUrl?: string;
  /** BFF refresh endpoint (default: /auth/refresh) */
  refreshUrl?: string;
  /** Called when an auth error occurs */
  onAuthError?: (error: Error) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  loginUrl = "/auth/login",
  logoutUrl = "/auth/logout",
  sessionUrl = "/auth/session",
  refreshUrl = "/auth/refresh",
  onAuthError,
}: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;

  const login = useCallback(() => {
    window.location.href = loginUrl;
  }, [loginUrl]);

  const logout = useCallback(() => {
    window.location.href = logoutUrl;
  }, [logoutUrl]);

  // Check session on mount
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const checkSession = async () => {
      try {
        const res = await fetch(sessionUrl, { credentials: "same-origin" });
        if (res.ok) {
          const data = (await res.json()) as { authenticated: boolean; user?: AuthUser };
          if (data.authenticated && data.user) {
            setUser(data.user);
            setIsLoading(false);
            return;
          }
        }

        // Session expired or missing — try silent refresh
        // The /refresh endpoint returns { authenticated, user } directly to avoid a third round-trip
        if (res.status === 401) {
          const refreshRes = await fetch(refreshUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-Requested-With": "fz-auth" },
          });
          if (refreshRes.ok) {
            const data = (await refreshRes.json()) as { authenticated?: boolean; user?: AuthUser };
            if (data.authenticated && data.user) {
              setUser(data.user);
              setIsLoading(false);
              return;
            }
          }
        }

        setUser(null);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        onAuthErrorRef.current?.(err);
        setUser(null);
      }
      setIsLoading(false);
    };

    checkSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
