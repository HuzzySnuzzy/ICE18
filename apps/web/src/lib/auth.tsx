import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MetaInfo, PublicUser } from '@ice18/shared';
import { api, ApiError } from './api';

interface AuthState {
  user: PublicUser | null;
  meta: MetaInfo | null;
  loading: boolean;
  setUser: (user: PublicUser | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [meta, setMeta] = useState<MetaInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [metaResult, userResult] = await Promise.allSettled([
      api<MetaInfo>('/auth/meta'),
      api<PublicUser>('/auth/me'),
    ]);
    if (metaResult.status === 'fulfilled') setMeta(metaResult.value);
    if (userResult.status === 'fulfilled') setUser(userResult.value);
    else if (userResult.reason instanceof ApiError && userResult.reason.status === 401) setUser(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ user, meta, loading, setUser, refresh, logout }), [user, meta, loading, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
