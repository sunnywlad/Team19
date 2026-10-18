// Toute réponse d'API est une donnée hostile : elle passe ici avant d'atteindre
// un composant. Une réponse non conforme lève InvalidResponse et n'est pas
// affichée. Les validateurs sont précompilés (tools/gen-validators.mjs).
import * as generated from "../generated/validators.js";
import type { AjvValidator } from "../generated/validators.js";
import type {
  IncidentItem,
  IncidentReport,
  JournalEntry,
  JournalVerification,
  Libelles,
  PausedAgent,
  QueueRow,
  RelayDecision,
  RelayEvent,
  RelayStatus,
  Unite,
  VaultState,
} from "../api/types.ts";

export class InvalidResponse extends Error {
  constructor(what: string, detail: string) {
    super(`${what} : réponse non conforme au schéma (${detail})`);
    this.name = "InvalidResponse";
  }
}

export type Parser<T> = (data: unknown) => T;

function parser<T>(what: string, validator: AjvValidator): Parser<T> {
  return (data) => {
    if (validator(data)) return data as T;
    const first = validator.errors?.[0];
    // Le chemin et le mot-clé seulement : jamais la valeur fautive.
    const detail = first ? `${first.instancePath.slice(0, 80) || "/"} : ${first.keyword}` : "forme inattendue";
    throw new InvalidResponse(what, detail);
  };
}

export const parse = {
  relayStatus: parser<RelayStatus>("état de l'indexeur", generated.relayStatus),
  relayDecisions: parser<RelayDecision[]>("décisions", generated.relayDecisions),
  relayEvents: parser<RelayEvent[]>("événements", generated.relayEvents),
  relayQueue: parser<QueueRow[]>("file", generated.relayQueue),
  vaultState: parser<VaultState>("état du coffre", generated.vaultState),
  incidents: parser<IncidentItem[]>("incidents", generated.incidents),
  journalEntries: parser<JournalEntry[]>("journal", generated.journalEntries),
  journalVerification: parser<JournalVerification>("vérification du journal", generated.journalVerification),
  pausedAgents: parser<PausedAgent[]>("agents en pause", generated.pausedAgents),
  incidentReport: parser<IncidentReport>("rapport d'incident", generated.incidentReport),
  journalEntry: parser<JournalEntry>("entrée de journal", generated.journalEntry),
  libelles: parser<Libelles>("libellés", generated.libelles),
  unite: parser<Unite>("unité d'affichage", generated.unite),
};
