import { useCallback, useEffect, useRef, useState } from 'react';
import { useFitcheckApi } from './context.js';
import type { FitcheckApi } from './types.js';

export type QueryState<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
  refetch: () => Promise<void>;
};

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * Loads on mount and whenever `key` changes; `refetch` reloads in place and keeps the
 * current data visible. A reply superseded by a newer load is dropped.
 */
export function useQuery<T>(load: (api: FitcheckApi) => Promise<T>, key: string): QueryState<T> {
  const api = useFitcheckApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names what is loaded
  const run = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    try {
      const result = await loader.current(api);
      if (mine !== generation.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (mine !== generation.current) return;
      setError(asError(e));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [api, key]);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, error, loading, refetch: run };
}
