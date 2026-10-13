// Le bandeau de trésorerie : quatre faits lus au coffre, au relais et au service
// de réponse. Une valeur qui n'a pas pu être lue vaut null et s'affiche « Non
// mesuré », jamais 0.
import type { PausedAgent, RelayEvent, VaultState } from "../api/types.ts";

export type Treasury = {
  /** Somme des événements Paid lus au relais, en wei. null : événements non lus, ou montant illisible. */
  paidWei: string | null;
  /** Nombre d'événements Paid lus. */
  paidCount: number | null;
  /** totalHeld() du coffre : montant bloqué par les cas 1 en attente. */
  heldWei: string | null;
  /** Agents écartés par le service de réponse. */
  pausedAgents: number | null;
  vaultPaused: boolean | null;
};

const WEI = /^\d{1,78}$/;

/**
 * Montant sorti : la somme des Paid que le relais a servis, rien d'autre. Si un
 * seul montant est illisible, le total n'est pas donné : un total partiel se
 * lirait comme un total.
 */
export function treasuryOf(events: RelayEvent[] | null, vault: VaultState | null, paused: PausedAgent[] | null): Treasury {
  let paidWei: string | null = null;
  let paidCount: number | null = null;
  if (events !== null) {
    const amounts = events.filter((e) => e.name === "Paid").map((e) => e.args["amount"]);
    paidCount = amounts.length;
    paidWei = amounts.every((a): a is string => typeof a === "string" && WEI.test(a)) ? amounts.reduce((sum, a) => sum + BigInt(a), 0n).toString() : null;
  }
  return {
    paidWei,
    paidCount,
    heldWei: vault?.total_held_wei ?? null,
    pausedAgents: paused === null ? null : paused.length,
    vaultPaused: vault?.vault_paused ?? null,
  };
}
