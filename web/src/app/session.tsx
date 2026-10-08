import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type Me, type StoreSummary } from './api';

interface SessionValue {
  loading: boolean;
  me: Me | null;
  store: StoreSummary | null;
  setStoreId: (id: string) => void;
  refresh: () => Promise<void>;
  setMe: (me: Me | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);
const KEY = 'rr.store';

function readStoreId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeStoreId(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode: fine, we just won't remember */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [storeId, setStoreIdState] = useState<string | null>(readStoreId());

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/app-api/me'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
      else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => setLoading(false));
    const onUnauthorized = () => setMe(null);
    window.addEventListener('rr:unauthorized', onUnauthorized);
    return () => window.removeEventListener('rr:unauthorized', onUnauthorized);
  }, [refresh]);

  const store = useMemo(() => {
    if (!me?.stores.length) return null;
    return me.stores.find((s) => s.id === storeId) ?? me.stores[0] ?? null;
  }, [me, storeId]);

  const value: SessionValue = {
    loading,
    me,
    store,
    setMe,
    refresh,
    setStoreId: (id) => {
      setStoreIdState(id);
      writeStoreId(id);
    },
    logout: async () => {
      await api.post('/auth/logout').catch(() => undefined);
      setMe(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Small data-fetching hook with loading/error/reload. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Something went wrong.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
