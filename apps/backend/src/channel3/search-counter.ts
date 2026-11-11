/** Counts paid searches per UTC day. */
export interface SearchCounter {
  /** Takes one search for `day`; false when the day's count already reached `limit`. */
  take(day: string, limit: number): boolean;
}

export function createInMemorySearchCounter(): SearchCounter {
  const counts = new Map<string, number>();
  return {
    take(day, limit) {
      const used = counts.get(day) ?? 0;
      if (used >= limit) return false;
      counts.set(day, used + 1);
      return true;
    },
  };
}
