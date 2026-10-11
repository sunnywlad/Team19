// Point b de specs/00-a-trancher.md : la pause d'un agent s'applique aussi au
// relais. Deux sources : la liste hors chaîne tenue par le service de réponse
// (bouchon ici), et la vue agentPaused() du contrat.
import type { Hex } from "./types.ts";
import type { VaultClient } from "./vault.ts";

export interface PauseSource {
  /** Lève une erreur si la source est injoignable : le relais échoue fermé. */
  isPaused(agentId: Hex): Promise<boolean>;
}

/** Bouchon de la liste hors chaîne. À remplacer par un appel au service de réponse. */
export class StaticPauseSource implements PauseSource {
  readonly paused = new Set<Hex>();
  async isPaused(agentId: Hex): Promise<boolean> {
    return this.paused.has(agentId);
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
