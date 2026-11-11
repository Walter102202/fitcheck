import type { ConfigResponse } from '@fitcheck/contracts';
import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react';
import type { FitcheckApi } from './types.js';
import { type QueryState, useQuery } from './use-query.js';

const loadConfig = (api: FitcheckApi) => api.getConfig();
const AppConfigContext = createContext<QueryState<ConfigResponse> | null>(null);

/** One GET /api/config shared by every consumer below this provider. */
export function AppConfigProvider({ children }: { children: ReactNode }) {
  const config = useQuery(loadConfig, 'config');
  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

/** The shared config. A consumer that mounts after a failed load asks again, once. */
export function useAppConfig(): QueryState<ConfigResponse> {
  const config = useContext(AppConfigContext);
  if (!config) throw new Error('useAppConfig must be used inside AppConfigProvider');
  const retried = useRef(false);
  const { error, loading, refetch } = config;
  useEffect(() => {
    if (error && !loading && !retried.current) {
      retried.current = true;
      void refetch();
    }
  }, [error, loading, refetch]);
  return config;
}
