import { useEffect, useState } from 'react';

/**
 * Returns `true` only after `active` has stayed `true` continuously for
 * `delayMs`. When `active` flips back to `false`, the result drops to `false`
 * immediately.
 *
 * Used to gate loading skeletons: near-instant hydrations (cached/already
 * resident data) resolve inside the grace window, so the skeleton never
 * mounts and the user doesn't see a single-frame pulse flash. Genuinely slow
 * loads still get the skeleton once they cross the threshold.
 */
export function useDelayedFlag(active: boolean, delayMs = 120): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const id = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(id);
  }, [active, delayMs]);
  return shown;
}
