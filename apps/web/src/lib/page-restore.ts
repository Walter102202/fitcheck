import { useEffect, useRef } from 'react';

/**
 * Runs `onRestore` when Back brings this page out of the browser's back-forward cache. The
 * page comes back exactly as it was left, so a button locked on the way to PayPal stays locked
 * unless the screen releases it here.
 */
export function useOnPageRestore(onRestore: () => void) {
  const latest = useRef(onRestore);
  latest.current = onRestore;
  useEffect(() => {
    const handler = (event: Event) => {
      if ((event as PageTransitionEvent).persisted) latest.current();
    };
    window.addEventListener('pageshow', handler);
    return () => window.removeEventListener('pageshow', handler);
  }, []);
}
