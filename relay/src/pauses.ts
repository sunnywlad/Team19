// Point b de specs/00-a-trancher.md : la pause d'un agent s'applique aussi au
// relais. Deux sources : la liste hors chaîne tenue par le service de réponse
// (HttpPauseSource, ou le bouchon StaticPauseSource), et la vue agentPaused()
// du contrat.
import { systemClock, type Clock, type Hex } from "./types.ts";
import type { VaultClient } from "./vault.ts";

export interface PauseSource {
  /** Lève une erreur si la source est injoignable : le relais échoue fermé. */
  isPaused(agentId: Hex): Promise<boolean>;
}

/** Bouchon de la liste hors chaîne, pour les tests et quand PAUSE_SOURCE_URL est absente. */
export class StaticPauseSource implements PauseSource {
  readonly paused = new Set<Hex>();
  async isPaused(agentId: Hex): Promise<boolean> {
    return this.paused.has(agentId);
  }
}

export const DEFAULT_PAUSE_SOURCE_URL = "http://127.0.0.1:8790";
/** Durée de vie maximale de la liste lue : une pause posée s'applique en 2 s au plus. */
export const PAUSE_CACHE_MS = 2000;
// Le service de réponse coupe sa liste à 200 lignes (response/README.md).
const PAUSE_LIST_MAX = 200;
const BYTES32 = /^0x[0-9a-f]{64}$/;

/** La liste des pauses n'a pas pu être lue. L'appelant échoue fermé. */
export class PauseSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PauseSourceError";
  }
}

/**
 * Liste des pauses tenue par le service de réponse : GET {base}/agents/paused
 * (response/README.md, « Lire »). Un agent est en pause dès qu'une ligne le
 * nomme, quel que soit son niveau. Service injoignable, réponse autre que 200
 * ou liste illisible : exception, jamais « pas en pause ». Seule une lecture
 * réussie est gardée, 2 s au plus.
 */
export class HttpPauseSource implements PauseSource {
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #clock: Clock;
  #cache: { atMs: number; paused: Set<string> } | null = null;

  constructor(baseUrl: string = DEFAULT_PAUSE_SOURCE_URL, options: { timeoutMs?: number; clock?: Clock } = {}) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("PAUSE_SOURCE_URL doit être en http(s)");
    this.#endpoint = `${url.origin}/agents/paused`;
    this.#timeoutMs = options.timeoutMs ?? 2000;
    this.#clock = options.clock ?? systemClock;
  }

  async isPaused(agentId: Hex): Promise<boolean> {
    const now = this.#clock();
    const cached = this.#cache;
    // Une horloge qui recule invalide le cache : on relit.
    if (cached && now >= cached.atMs && now - cached.atMs < PAUSE_CACHE_MS) return cached.paused.has(agentId);
    this.#cache = null;
    const paused = await this.#read();
    this.#cache = { atMs: now, paused };
    return paused.has(agentId);
  }

  async #read(): Promise<Set<string>> {
    let body: unknown;
    try {
      const response = await fetch(this.#endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(this.#timeoutMs) });
      if (response.status !== 200) throw new Error("statut");
      body = await response.json();
    } catch {
      // Pas de détail : le message d'origine peut contenir l'URL.
      throw new PauseSourceError("liste des pauses injoignable");
    }
    // Liste pleine : elle a pu être coupée, un agent en pause peut y manquer.
    if (!Array.isArray(body) || body.length >= PAUSE_LIST_MAX) throw new PauseSourceError("liste des pauses illisible");
    const paused = new Set<string>();
    for (const line of body as unknown[]) {
      const agentId = (line as { agent_id?: unknown } | null)?.agent_id;
      if (typeof agentId !== "string" || !BYTES32.test(agentId)) throw new PauseSourceError("liste des pauses illisible");
      paused.add(agentId);
    }
    return paused;
  }
}

export class VaultPauseSource implements PauseSource {
  readonly #vault: VaultClient;
  constructor(vault: VaultClient) {
    this.#vault = vault;
  }
  isPaused(agentId: Hex): Promise<boolean> {
    return this.#vault.agentPaused(agentId);
  }
}

/** En pause dès qu'une source le dit. Une source en erreur fait échouer l'ensemble. */
export function anyPause(...sources: PauseSource[]): PauseSource {
  return {
    async isPaused(agentId: Hex): Promise<boolean> {
      for (const source of sources) if (await source.isPaused(agentId)) return true;
      return false;
    },
  };
}
