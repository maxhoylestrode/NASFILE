import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { setOnSessionExpired } from '../api/client';
import { clearSession, getStoredRootFolderId, getStoredUser, saveSession } from '../api/tokenStore';
import type { AuthUser } from '../api/types';

interface AuthState {
  user: AuthUser | null;
  rootFolderId: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithSession: (session: { accessToken: string; refreshToken: string; user: AuthUser; rootFolderId: string }) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [rootFolderId, setRootFolderId] = useState<string | null>(() => getStoredRootFolderId());
  const [loading] = useState(false);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setRootFolderId(null);
  }, []);

  useEffect(() => {
    setOnSessionExpired(logout);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    saveSession(res);
    setUser(res.user);
    setRootFolderId(res.rootFolderId);
  }, []);

  const loginWithSession = useCallback(
    (session: { accessToken: string; refreshToken: string; user: AuthUser; rootFolderId: string }) => {
      saveSession(session);
      setUser(session.user);
      setRootFolderId(session.rootFolderId);
    },
    [],
  );

  return (
    <AuthContext.Provider value={{ user, rootFolderId, loading, login, loginWithSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
