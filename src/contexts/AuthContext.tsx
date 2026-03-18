import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

interface AuthUser {
  id: string;
  _id: string; // keep both so user?._id and user?.id both work
  email: string;
  fullName: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  checkUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => ({ ok: false }),
  signOut: async () => {},
  checkUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // FIX: cache: 'no-store' prevents Next.js from returning stale /me response
  // after account switch — this was the root cause of the role delay bug
  const checkUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', {
        cache: 'no-store',        // never use cached response
        credentials: 'include',   // always send cookie
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setUser({
          id:       String(data.user._id || data.user.id || ''),
          _id:      String(data.user._id || data.user.id || ''),
          email:    data.user.email    || '',
          fullName: data.user.fullName || data.user.email || 'User',
          role:     data.user.role     || 'employee',
        });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load user on app start
  useEffect(() => {
    checkUser();
  }, [checkUser]);

  // FIX: login now calls checkUser after successful login
  // This is what was missing — user object was never refreshed after switching accounts
  const login = useCallback(async (email: string, password: string) => {
    try {
      setLoading(true);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setLoading(false);
        return { ok: false, error: data.error || 'Login failed' };
      }

      // FIX: immediately re-fetch current user from /me
      // so role, fullName, id are fresh for the NEW account
      await checkUser();
      return { ok: true };
    } catch {
      setLoading(false);
      return { ok: false, error: 'Network error' };
    }
  }, [checkUser]);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore — clear state regardless
    } finally {
      // FIX: clear user state immediately on logout
      setUser(null);
      setLoading(false);
      window.location.href = '/auth';
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signOut, checkUser }}>
      {children}
    </AuthContext.Provider>
  );
};