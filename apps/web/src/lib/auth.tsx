import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ApiError, authApi, type DisplayPreferences, type SessionUser } from './api';
import { setClockFormat } from './operations-api';

interface AuthContextValue {
  session: SessionUser | null;
  /** How this deployment writes dates, times and the organisation's own name. */
  display: DisplayPreferences | null;
  /** True until the initial session probe finishes. */
  loading: boolean;
  signIn: (input: { email: string; password: string; totp?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  can: (module: string, action: string) => boolean;
  /** Called after the settings screen saves, so the change shows without a reload. */
  refreshDisplay: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [display, setDisplayState] = useState<DisplayPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Applies the deployment's display preferences.
   *
   * `setClockFormat` writes a module-level value the date formatters read, so it has to
   * run before anything renders a time. Kept in state as well, so a screen that needs to
   * show which format is in force does not have to ask the formatter.
   */
  const setDisplay = useCallback((value: DisplayPreferences | undefined) => {
    if (value === undefined) return;
    setClockFormat(value.timeFormat);
    setDisplayState(value);
  }, []);

  /**
   * Restores the session on load.
   *
   * The token lives in an http-only cookie, so the client cannot read it and has
   * to ask the server who it is. A 401 here is the expected answer for a visitor
   * who is simply not logged in, not an error worth surfacing.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await authApi.me();
        if (!cancelled) {
          setSession(result.user);
          setDisplay(result.display);
        }
      } catch (error) {
        if (!cancelled && !(error instanceof ApiError && error.status === 401)) {
          console.error('Session probe failed', error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (input: { email: string; password: string; totp?: string }) => {
      const result = await authApi.login(input);
      setSession(result.user);
      setDisplay(result.display);
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Cleared regardless: if the call failed the cookie may still be gone, and
      // leaving a stale session on screen is worse than an extra login.
      setSession(null);
    }
  }, []);

  const can = useCallback(
    (module: string, action: string) => {
      const granted = session?.permissions[module];
      return Array.isArray(granted) && granted.includes(action);
    },
    [session],
  );

  const refreshDisplay = useCallback(async () => {
    try {
      setDisplay((await authApi.me()).display);
    } catch {
      // A stale clock format is not worth an error strip on a screen that just saved.
    }
  }, [setDisplay]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, display, loading, signIn, signOut, can, refreshDisplay }),
    [session, display, loading, signIn, signOut, can, refreshDisplay],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
