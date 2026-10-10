// Interrogation périodique d'une famille de données : toutes les 2 s, recul
// exponentiel en cas d'erreur, et une notion explicite de fraîcheur. Une valeur
// n'est « à jour » que si une lecture a réussi depuis moins de 10 s.

export const POLL_INTERVAL_MS = 2000;
export const MAX_BACKOFF_MS = 30000;
export const REQUEST_TIMEOUT_MS = 5000;
export const STALE_AFTER_MS = 10000;

export type Snapshot<T> = {
  /** Dernière lecture valide. Conservée en cas d'erreur, mais plus « à jour ». */
  data: T | null;
  lastOkAt: number | null;
  /** Erreur de la dernière tentative, null si elle a réussi. */
  error: string | null;
  startedAt: number;
  failures: number;
};

export type PollerOptions = { intervalMs?: number; now?: () => number };

export function backoffDelay(failures: number, intervalMs: number = POLL_INTERVAL_MS): number {
  return Math.min(intervalMs * 2 ** Math.min(failures, 10), MAX_BACKOFF_MS);
}

/** Aucune lecture réussie depuis plus de 10 s : la valeur ne doit plus passer pour à jour. */
export function isStale(snapshot: Snapshot<unknown>, now: number): boolean {
  return now - (snapshot.lastOkAt ?? snapshot.startedAt) > STALE_AFTER_MS;
}

export class Poller<T> {
  readonly #load: (signal: AbortSignal) => Promise<T>;
  readonly #interval: number;
  readonly #now: () => number;
  readonly #listeners = new Set<() => void>();
  #snapshot: Snapshot<T>;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #abort: AbortController | null = null;
  #running = false;
  /** Change à chaque arrêt : une lecture lancée avant l'arrêt n'écrit plus rien. */
  #generation = 0;

  constructor(load: (signal: AbortSignal) => Promise<T>, options: PollerOptions = {}) {
    this.#load = load;
    this.#interval = options.intervalMs ?? POLL_INTERVAL_MS;
    this.#now = options.now ?? Date.now;
    this.#snapshot = { data: null, lastOkAt: null, error: null, startedAt: this.#now(), failures: 0 };
  }

  getSnapshot = (): Snapshot<T> => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.#tick(this.#generation);
  }

  stop(): void {
    this.#running = false;
    this.#generation += 1;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#abort?.abort();
  }

  #set(next: Snapshot<T>): void {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }

  async #tick(generation: number): Promise<void> {
    const current = (): boolean => this.#running && generation === this.#generation;
    const abort = new AbortController();
    this.#abort = abort;
    // Une API qui ne répond pas compte comme une erreur, pas comme une attente.
    const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    let failures = 0;
    try {
      const data = await this.#load(abort.signal);
      if (!current()) return;
      this.#set({ ...this.#snapshot, data, lastOkAt: this.#now(), error: null, failures: 0 });
    } catch (error) {
      if (!current()) return;
      failures = this.#snapshot.failures + 1;
      const message = error instanceof Error && error.name === "ApiError" ? error.message : "erreur inattendue pendant la lecture";
      this.#set({ ...this.#snapshot, error: message, failures });
    } finally {
      clearTimeout(timeout);
    }
    if (!current()) return;
    this.#timer = setTimeout(() => void this.#tick(generation), failures === 0 ? this.#interval : backoffDelay(failures, this.#interval));
  }
}
