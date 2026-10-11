import type { Source, Sources, TagSource, VaultOrigin } from "../api/types.ts";
import type { Reaction } from "../components/DecisionsTable.tsx";
import type { RelayData, ResponseData } from "../data/load.ts";
import { reactionsFor } from "../domain/activity.ts";
import type { Snapshot } from "../hooks/poller.ts";

/** Ce que chaque écran reçoit : les trois familles de données, leur fraîcheur, leur provenance. */
export type ViewProps = {
  relay: Snapshot<RelayData>;
  vault: Snapshot<import("../api/types.ts").VaultState>;
  response: Snapshot<ResponseData>;
  sources: Sources;
  /** Contrat ou faux coffre derrière le relais. */
  vaultOrigin: VaultOrigin;
  now: number;
};

/**
 * Étiquette d'un panneau alimenté par le coffre (décisions, événements, état).
 * « réel » seulement si le relais est réel ET qu'il lit un contrat : un faux
 * coffre ne doit jamais se lire comme un vrai.
 */
export function vaultFed(source: Source, origin: VaultOrigin): TagSource {
  if (source !== "reel" || origin === "chaine" || origin === "sans-objet") return source;
  return origin === "faux-coffre" ? "faux-coffre" : "non-confirme";
}

/**
 * Les données du service de réponse se rapportent-elles aux mêmes demandes que
 * celles du relais ? Non si l'un est réel et l'autre simulé : on ne rapproche
 * alors rien, plutôt que d'afficher « aucune réponse » à tort.
 */
export function sameWorld(sources: Sources): boolean {
  return sources.relay === sources.response;
}

export function makeReactionFor(sources: Sources, response: ResponseData | null): (requestId: string) => Reaction {
  return (requestId) => {
    if (!sameWorld(sources)) return { available: false, why: "non disponible : service de réponse simulé" };
    if (response === null) return { available: false, why: "non disponible" };
    return { available: true, labels: reactionsFor(requestId, response.incidents, response.journal) };
  };
}
