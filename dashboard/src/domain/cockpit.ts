// Ce que le bandeau d'état de l'accueil lit, sans rien inventer : chaque valeur
// vient d'une réponse déjà servie (événements du relais, état du coffre, agents
// en pause du service de réponse). Une valeur qu'on ne peut pas lire reste null.
import type { PausedAgent, RelayEvent } from "../api/types.ts";
import { chainPausedAgents } from "./activity.ts";

const WEI = /^(0|[1-9][0-9]{0,77})$/;

export type PaidTotal = { wei: string; payments: number };

/**
 * Montant sorti : somme des événements Paid lus. null si la lecture est
 * tronquée (le total serait faux) : la page dit alors « Non mesuré ».
 */
export function paidTotal(events: RelayEvent[], truncated: boolean): PaidTotal | null {
  if (truncated) return null;
  let total = 0n;
  let payments = 0;
  for (const e of events) {
    if (e.name !== "Paid") continue;
    const amount = e.args.amount;
    if (typeof amount !== "string" || !WEI.test(amount)) continue;
    total += BigInt(amount);
    payments += 1;
  }
  return { wei: total.toString(), payments };
}

/** Montant renvoyé par une vue : strictement positif ? null si illisible. */
export function isPositiveWei(wei: string | null | undefined): boolean | null {
  if (typeof wei !== "string" || !WEI.test(wei)) return null;
  return BigInt(wei) > 0n;
}

export type PauseCount = { offchain: number | null; onchain: number | null };

/** Agents en pause : hors chaîne (service de réponse), sur la chaîne (événements). Chaque côté null s'il n'est pas lu. */
export function pauseCount(paused: PausedAgent[] | null, events: RelayEvent[] | null): PauseCount {
  return {
    offchain: paused === null ? null : paused.filter((p) => p.scope === "OFFCHAIN").length,
    onchain: events === null ? null : chainPausedAgents(events).length,
  };
}
