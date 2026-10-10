// Lecture de l'indexeur du relais (specs/00, point d) : le contrat ne notifie
// personne, donc le service de réponse interroge l'API en lecture seule du
// relais et transmet ce qu'il lit au moteur de réponse.
//
// Si le relais ne répond pas, aucune décision n'est faussée, mais la réponse
// automatique aux refus du contrat s'arrête : c'est signalé une fois.
import type { IndexedDecision, QueueRow, ResponseEngine } from "./engine.ts";

const PAGE = 200;

export class RelayWatch {
  readonly #baseUrl: string;
  readonly #engine: ResponseEngine;
  readonly #timeoutMs: number;
  #sinceId = 0;
  #reachable = true;

  constructor(baseUrl: string, engine: ResponseEngine, timeoutMs = 2000) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#engine = engine;
    this.#timeoutMs = timeoutMs;
  }

  async #get(path: string): Promise<unknown> {
    const response = await fetch(`${this.#baseUrl}${path}`, { signal: AbortSignal.timeout(this.#timeoutMs) });
    if (!response.ok) throw new Error(`relais : ${response.status}`);
    return response.json();
  }

  #mark(reachable: boolean): void {
    if (reachable !== this.#reachable) {
      console.error(reachable ? "réponse : relais de nouveau joignable" : "réponse : relais injoignable, refus du contrat non traités");
    }
    this.#reachable = reachable;
  }

  /** Lit les nouvelles décisions. Renvoie leur nombre, ou -1 si le relais ne répond pas. */
  async pollDecisions(): Promise<number> {
    let seen = 0;
    try {
      for (;;) {
        const page = (await this.#get(`/decisions?since_id=${this.#sinceId}&limit=${PAGE}`)) as (IndexedDecision & { id: number })[];
        for (const decision of [...page].sort((a, b) => a.id - b.id)) {
          // Un événement déjà recopié dans le journal est ignoré par le moteur.
          this.#engine.observeDecision(decision);
          this.#sinceId = Math.max(this.#sinceId, decision.id);
          seen += 1;
        }
        if (page.length < PAGE) break;
      }
      this.#mark(true);
      return seen;
    } catch {
      this.#mark(false);
      return -1;
    }
  }

  /** Surveille la file : une demande qui attend trop déclenche une alerte de disponibilité. */
  async pollQueue(): Promise<boolean> {
    try {
      this.#engine.checkQueue((await this.#get(`/queue?limit=${PAGE}`)) as QueueRow[]);
      return true;
    } catch {
      return false;
    }
  }
}
