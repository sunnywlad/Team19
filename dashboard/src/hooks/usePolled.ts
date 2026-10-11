import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Poller, type Snapshot } from "./poller.ts";

/** Interroge « load » tant que le composant est monté. « load » doit être stable. */
export function usePolled<T>(load: (signal: AbortSignal) => Promise<T>): Snapshot<T> {
  const poller = useMemo(() => new Poller(load), [load]);
  useEffect(() => {
    poller.start();
    return () => poller.stop();
  }, [poller]);
  return useSyncExternalStore(poller.subscribe, poller.getSnapshot);
}

/** Heure courante, rafraîchie chaque seconde : fraîcheur des données et comptes à rebours. */
export function useNow(intervalMs: number = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
