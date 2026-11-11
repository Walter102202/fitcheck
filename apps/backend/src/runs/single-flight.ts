const inFlight = new Map<string, Promise<unknown>>();

/**
 * Concurrent calls with the same key share one execution and one result: a double-click or a
 * retried request does the work once. The key is released when the work settles.
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;
  const promise = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
