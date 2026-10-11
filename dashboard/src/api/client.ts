// ApiClient : une interface qui n'a QUE des lectures. Deux implémentations :
//   RealApiClient      : l'API en lecture seule de relay/ ; les points d'accès
//                        qui n'existent pas encore restent simulés (API-NEEDS.md).
//   SimulatedApiClient : tout vient du serveur de fixtures (npm run dev:fixtures),
//                        qui sert les mêmes chemins et les mêmes formes.
// Le navigateur n'appelle que sa propre origine : /api/* est relayé par le proxy
// local de vite.config.ts, qui porte les URLs (et un éventuel jeton) côté serveur.
import { getJson, type FetchLike } from "./http.ts";
import { InvalidResponse, parse } from "../validation/validate.ts";
import type {
  IncidentItem,
  JournalEntry,
  JournalVerification,
  PausedAgent,
  QueueRow,
  RelayDecision,
  RelayEvent,
  RelayStatus,
  Sources,
  VaultOrigin,
  VaultState,
} from "./types.ts";

export interface ApiClient {
  readonly sources: Sources;
  getRelayStatus(signal?: AbortSignal): Promise<RelayStatus>;
  getDecisions(signal?: AbortSignal): Promise<RelayDecision[]>;
  getEvents(signal?: AbortSignal): Promise<RelayEvent[]>;
  getQueue(signal?: AbortSignal): Promise<QueueRow[]>;
  getVaultState(signal?: AbortSignal): Promise<VaultState>;
  getIncidents(signal?: AbortSignal): Promise<IncidentItem[]>;
  getJournalEntries(signal?: AbortSignal): Promise<JournalEntry[]>;
  getJournalVerification(signal?: AbortSignal): Promise<JournalVerification>;
  getPausedAgents(signal?: AbortSignal): Promise<PausedAgent[]>;
  /** Contrat ou faux coffre derrière le relais : dit par le proxy local, pas par le relais. */
  getVaultOrigin(signal?: AbortSignal): Promise<VaultOrigin>;
}

/** Taille de page demandée au relais : son maximum (relay/src/api.ts, MAX_LIMIT). */
export const PAGE_LIMIT = 500;

const RELAY = "/api/relay";
const RESPONSE = "/api/reponse";
const SIMULATION = "/api/simulation";
const LOCAL_MODE = "/api/local/mode";

/** Réponse du proxy local : un seul champ, trois valeurs. Tout le reste est refusé. */
function parseVaultOrigin(data: unknown): VaultOrigin {
  if (typeof data === "object" && data !== null && !Array.isArray(data) && Object.keys(data).length === 1) {
    const { vault } = data as { vault?: unknown };
    if (vault === "fake") return "faux-coffre";
    if (vault === "chain") return "chaine";
    if (vault === "unknown") return "non-confirme";
  }
  throw new InvalidResponse("mode du coffre", "forme inattendue");
}

type Routes = { relay: string; vault: string; response: string };

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

abstract class GetOnlyClient implements ApiClient {
  abstract readonly sources: Sources;
  abstract getVaultOrigin(signal?: AbortSignal): Promise<VaultOrigin>;
  readonly #fetch: FetchLike;
  readonly #routes: Routes;

  protected constructor(routes: Routes, fetchFn: FetchLike) {
    this.#routes = routes;
    this.#fetch = fetchFn;
  }

  protected readLocalMode(signal?: AbortSignal): Promise<VaultOrigin> {
    return getJson(this.#fetch, LOCAL_MODE, parseVaultOrigin, signal);
  }

  getRelayStatus(signal?: AbortSignal): Promise<RelayStatus> {
    return getJson(this.#fetch, `${this.#routes.relay}/status`, parse.relayStatus, signal);
  }
  getDecisions(signal?: AbortSignal): Promise<RelayDecision[]> {
    return getJson(this.#fetch, `${this.#routes.relay}/decisions?limit=${PAGE_LIMIT}`, parse.relayDecisions, signal);
  }
  getEvents(signal?: AbortSignal): Promise<RelayEvent[]> {
    return getJson(this.#fetch, `${this.#routes.relay}/events?limit=${PAGE_LIMIT}`, parse.relayEvents, signal);
  }
  getQueue(signal?: AbortSignal): Promise<QueueRow[]> {
    return getJson(this.#fetch, `${this.#routes.relay}/queue?limit=${PAGE_LIMIT}`, parse.relayQueue, signal);
  }
  getVaultState(signal?: AbortSignal): Promise<VaultState> {
    return getJson(this.#fetch, `${this.#routes.vault}/vault`, parse.vaultState, signal);
  }
  getIncidents(signal?: AbortSignal): Promise<IncidentItem[]> {
    return getJson(this.#fetch, `${this.#routes.response}/incidents`, parse.incidents, signal);
  }
  getJournalEntries(signal?: AbortSignal): Promise<JournalEntry[]> {
    return getJson(this.#fetch, `${this.#routes.response}/journal/entries?limit=${PAGE_LIMIT}`, parse.journalEntries, signal);
  }
  getJournalVerification(signal?: AbortSignal): Promise<JournalVerification> {
    return getJson(this.#fetch, `${this.#routes.response}/journal/verification`, parse.journalVerification, signal);
  }
  getPausedAgents(signal?: AbortSignal): Promise<PausedAgent[]> {
    return getJson(this.#fetch, `${this.#routes.response}/agents/paused`, parse.pausedAgents, signal);
  }
}

export type RealOptions = {
  /** Le relais sert GET /vault (API-NEEDS.md § 1). Sinon : simulation. */
  vaultFromRelay?: boolean;
  /** Un service de réponse est branché (API-NEEDS.md § 2 à 5). Sinon : simulation. */
  responseAvailable?: boolean;
};

export class RealApiClient extends GetOnlyClient {
  readonly sources: Sources;
  constructor(options: RealOptions = {}, fetchFn: FetchLike = defaultFetch) {
    super(
      {
        relay: RELAY,
        vault: options.vaultFromRelay ? RELAY : SIMULATION,
        response: options.responseAvailable ? RESPONSE : SIMULATION,
      },
      fetchFn,
    );
    this.sources = {
      relay: "reel",
      vault: options.vaultFromRelay ? "reel" : "simulation",
      response: options.responseAvailable ? "reel" : "simulation",
    };
  }
  getVaultOrigin(signal?: AbortSignal): Promise<VaultOrigin> {
    return this.readLocalMode(signal);
  }
}

export class SimulatedApiClient extends GetOnlyClient {
  readonly sources: Sources = { relay: "simulation", vault: "simulation", response: "simulation" };
  constructor(fetchFn: FetchLike = defaultFetch) {
    super({ relay: SIMULATION, vault: SIMULATION, response: SIMULATION }, fetchFn);
  }
  /** Tout est déjà étiqueté « simulation » : rien à demander. */
  getVaultOrigin(): Promise<VaultOrigin> {
    return Promise.resolve("sans-objet");
  }
}
