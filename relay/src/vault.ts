// Une seule interface vers le coffre, deux implémentations : FakeVault (en
// mémoire, pour les tests) et ChainVault (viem). Le relais et l'indexeur ne
// connaissent que cette interface.
import type { Hex, SignedRequest } from "./types.ts";

/**
 * Issue d'une soumission, vue du relais. Ce n'est PAS la décision du contrat :
 * celle-ci ne se lit que dans l'événement Decision (specs/02 § 1).
 */
export type SubmitOutcome =
  /** La transaction est partie. */
  | { kind: "sent"; txHash: Hex }
  /** Certain : rien n'a été diffusé. L'identifiant n'a pas pu être consommé. */
  | { kind: "not_sent"; cause: string }
  /** Incertain : la transaction a pu partir. Ne jamais renvoyer tout seul. */
  | { kind: "unknown"; cause: string; txHash: Hex | null };

export type EventArgs = Record<string, string | number | boolean>;

export type VaultEvent = {
  name: string;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  /** Horodatage du bloc, en secondes. */
  blockTimestamp: number;
  /** Arguments décodés ; les entiers 256 bits sont en chaîne décimale. */
  args: EventArgs;
};

/**
 * Vues de specs/02 § 4, lues au même bloc, sans aucun calcul ici. Une vue qui
 * n'a pas pu être lue vaut null : le lecteur affiche « non disponible », jamais
 * 0. Forme attendue par le dashboard (dashboard/API-NEEDS.md § 1). Montants en
 * wei, chaîne décimale.
 */
export type VaultState = {
  block_number: number;
  /** Horodatage du bloc, en secondes. */
  block_timestamp: number;
  cash_wei: string | null;
  admitted_debts_wei: string | null;
  safety_reserve_wei: string | null;
  total_held_wei: string | null;
  held_placements_wei: string | null;
  placeable_wei: string | null;
  threshold_wei: string | null;
  vault_paused: boolean | null;
};

export interface VaultClient {
  submit(request: SignedRequest): Promise<SubmitOutcome>;
  /** Lève une erreur si le coffre est injoignable : l'appelant échoue fermé. */
  agentPaused(agentId: Hex): Promise<boolean>;
  blockNumber(): Promise<bigint>;
  /** Événements du coffre sur l'intervalle de blocs, bornes incluses, dans l'ordre. */
  events(fromBlock: bigint, toBlock: bigint): Promise<VaultEvent[]>;
  /** Lève une erreur si le bloc de référence ne peut pas être lu. */
  state(): Promise<VaultState>;
}

/**
 * Coffre fermé : utilisé quand la configuration est incomplète (RPC ou adresse
 * absents). Rien n'est autorisé.
 */
export class ClosedVault implements VaultClient {
  readonly #cause: string;
  constructor(cause: string) {
    this.#cause = cause;
  }
  async submit(): Promise<SubmitOutcome> {
    return { kind: "not_sent", cause: this.#cause };
  }
  async agentPaused(): Promise<boolean> {
    throw new Error(this.#cause);
  }
  async blockNumber(): Promise<bigint> {
    throw new Error(this.#cause);
  }
  async events(): Promise<VaultEvent[]> {
    throw new Error(this.#cause);
  }
  async state(): Promise<VaultState> {
    throw new Error(this.#cause);
  }
}
