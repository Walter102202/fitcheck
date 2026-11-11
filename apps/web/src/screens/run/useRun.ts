import type { Answer, RunResponse } from '@fitcheck/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAppConfig } from '../../api/config.js';
import { useFitcheckApi } from '../../api/context.js';
import { ApiRequestError } from '../../api/errors.js';
import type { FitcheckApi } from '../../api/types.js';

// One start per purchase and mode in flight, so StrictMode's second effect, or a second
// mount while the first request is out, reuses the same promise instead of a second run.
const starting = new Map<string, Promise<RunResponse>>();

function startOnce(api: FitcheckApi, scenarioId: string, review: 'on' | 'off') {
  const key = `${scenarioId}:${review}`;
  let pending = starting.get(key);
  if (!pending) {
    pending = api.startRun({ scenarioId, review }).finally(() => starting.delete(key));
    starting.set(key, pending);
  }
  return pending;
}

const NO_CAP = new Set(['pending_approval', 'voided', 'expired']);

// Kept as thrown: a Zod 4 ZodError is not an `instanceof Error`, and wrapping it would turn
// its issue list into the message that readableError() exists to hide.
function asFailure(e: unknown): NonNullable<unknown> {
  return e ?? new Error('Unknown error');
}

/**
 * The purchase on screen. With `?run=` it reads that run back (reload, shared link);
 * otherwise it checks the cap and starts one run, then writes its id into the URL.
 * `enabled` waits until the screen knows the purchase exists.
 */
export function useRun(scenarioId: string, { enabled = true }: { enabled?: boolean } = {}) {
  const api = useFitcheckApi();
  const config = useAppConfig();
  const [params, setParams] = useSearchParams();
  const review: 'on' | 'off' = params.get('review') === 'off' ? 'off' : 'on';
  const runId = params.get('run');

  const [run, setRun] = useState<RunResponse | null>(null);
  const [error, setError] = useState<NonNullable<unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsCap, setNeedsCap] = useState(false);
  // A ?run= this session cannot read: a link from another visitor, or a visit since reset.
  const [stale, setStale] = useState(false);
  const [tries, setTries] = useState(0);
  const shown = useRef<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tries` re-runs the load on retry
  useEffect(() => {
    if (!enabled) return;
    if (runId && shown.current === runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStale(false);
    if (!runId) setRun(null);
    void (async () => {
      try {
        if (runId) {
          let loaded: RunResponse;
          try {
            loaded = await api.getRun(runId);
          } catch (e) {
            if (!(e instanceof ApiRequestError && e.status === 404)) throw e;
            if (!cancelled) setStale(true);
            return;
          }
          if (cancelled) return;
          shown.current = loaded.runId;
          setRun(loaded);
          return;
        }
        const cap = await api.getCap();
        if (cancelled) return;
        if (!cap || NO_CAP.has(cap.status)) {
          setNeedsCap(true);
          return;
        }
        const started = await startOnce(api, scenarioId, review);
        if (cancelled) return;
        shown.current = started.runId;
        setRun(started);
        setParams(
          review === 'off' ? { run: started.runId, review: 'off' } : { run: started.runId },
          { replace: true },
        );
      } catch (e) {
        if (!cancelled) setError(asFailure(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, enabled, runId, review, scenarioId, setParams, tries]);

  // The top bar's PayPal chip follows a session that fell back to simulated.
  const refreshed = useRef(false);
  const { data: configData, refetch: refetchConfig } = config;
  useEffect(() => {
    if (!run || !configData || refreshed.current) return;
    if (run.cap.mode !== configData.paypalMode) {
      refreshed.current = true;
      void refetchConfig();
    }
  }, [run, configData, refetchConfig]);

  const setReview = useCallback(
    (v: 'on' | 'off') => {
      shown.current = null;
      setParams(v === 'off' ? { review: 'off' } : {});
    },
    [setParams],
  );

  const retry = useCallback(() => {
    setTries((n) => n + 1);
  }, []);

  // Drops the unreadable ?run= and goes through the normal start: cap check, then one run.
  const startFresh = useCallback(() => {
    shown.current = null;
    setParams(review === 'off' ? { review: 'off' } : {}, { replace: true });
  }, [review, setParams]);

  const sendAnswers = useCallback(
    async (attemptNo: number, answers: Record<string, Answer>) => {
      if (!run) return;
      const updated = await api.sendAnswers(run.runId, { attemptNo, answers });
      setRun(updated);
    },
    [api, run],
  );

  return {
    run,
    error,
    loading,
    needsCap,
    stale,
    review,
    setReview,
    retry,
    startFresh,
    sendAnswers,
  };
}
