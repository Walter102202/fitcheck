import { createContext, type ReactNode, useContext } from 'react';
import type { FitcheckApi } from './types.js';

const ApiContext = createContext<FitcheckApi | null>(null);

/** Picks the API every screen uses: the real one, or the fake one in fixture mode and tests. */
export function ApiProvider({ api, children }: { api: FitcheckApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useFitcheckApi(): FitcheckApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useFitcheckApi must be used inside ApiProvider');
  return api;
}
