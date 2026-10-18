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
  DailyStats,
  IncidentItem,
  JournalEntry,
  JournalVerification,
  Libelles,
  PausedAgent,
  QueueRow,
  RelayDecision,
  RelayEvent,
  RelayStatus,
  Sources,
  Unite,
  VaultOrigin,
  VaultState,
} from "./types.ts";

export interface ApiClient {
  readonly sources: Sources;
  /**
   * La source sert les listes récentes (order=desc, API-NEEDS.md § 6) et les
   * agrégats par jour (GET /stats/daily, § 9). Vrai pour le serveur de fixtures
   * seulement : le relais ignorerait order=desc sans le dire.
   */
  readonly recent: boolean;
  /** Agrégats des 30 derniers jours (§ 9). Seulement si `recent`. */
  getDailyStats(signal?: AbortSignal): Promise<DailyStats>;
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
  /** Référentiel de libellés du proxy local (API-NEEDS.md § 7). */
  getLibelles(signal?: AbortSignal): Promise<Libelles>;
  /** Unité d'affichage déclarée par le proxy local (API-NEEDS.md § 8). */
  getUnite(signal?: AbortSignal): Promise<Unite>;
}

/** Taille de page demandée au relais : son maximum (relay/src/api.ts, MAX_LIMIT). */
export const PAGE_LIMIT = 500;

/**
 * Événements d'inscription et de réglage, relus à part en mode « listes
 * récentes » : les 500 derniers événements ne contiennent plus une inscription
 * vieille d'un mois. Liste fermée : chaque URL est une constante.
 */
const REGISTRATION_EVENTS = [
  "BeneficiaryRegistered",
  "AgentRegistered",
  "InvoiceRegistered",
  "PlacementRegistered",
  "HoldPlaced",
  "AgentPaused",
  "AgentResumed",
  "VaultPaused",
  "VaultResumed",
  "ThresholdChanged",
  "SafetyReserveChanged",
  "ApprovalDelayChanged",
] as const;

/** Réunit des pages d'événements : chaque événement une fois, dans l'ordre de l'indexeur. */
function mergeById<T extends { id: number }>(pages: T[][]): T[] {
  const byId = new Map<number, T>();
  for (const page of pages) for (const row of page) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

const RELAY = "/api/relay";
const RESPONSE = "/api/reponse";
const SIMULATION = "/api/simulation";
const LOCAL_MODE = "/api/local/mode";
const LOCAL_LIBELLES = "/api/local/libelles";
const LOCAL_UNITE = "/api/local/unite";

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
  abstract readonly recent: boolean;
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

  // Libellés et unité : servis par le proxy local dans les deux modes, jamais par le relais.
  getLibelles(signal?: AbortSignal): Promise<Libelles> {
    return getJson(this.#fetch, LOCAL_LIBELLES, parse.libelles, signal);
  }
  getUnite(signal?: AbortSignal): Promise<Unite> {
    return getJson(this.#fetch, LOCAL_UNITE, parse.unite, signal);
  }

  getRelayStatus(signal?: AbortSignal): Promise<RelayStatus> {
    return getJson(this.#fetch, `${this.#routes.relay}/status`, parse.relayStatus, signal);
  }
  getDecisions(signal?: AbortSignal): Promise<RelayDecision[]> {
    if (!this.recent) return getJson(this.#fetch, `${this.#routes.relay}/decisions?limit=${PAGE_LIMIT}`, parse.relayDecisions, signal);
    return getJson(this.#fetch, `${this.#routes.relay}/decisions?order=desc&limit=${PAGE_LIMIT}`, parse.relayDecisions, signal).then((rows) => mergeById([rows]));
  }
  async getEvents(signal?: AbortSignal): Promise<RelayEvent[]> {
    if (!this.recent) return getJson(this.#fetch, `${this.#routes.relay}/events?limit=${PAGE_LIMIT}`, parse.relayEvents, signal);
    const pages = await Promise.all([
      getJson(this.#fetch, `${this.#routes.relay}/events?order=desc&limit=${PAGE_LIMIT}`, parse.relayEvents, signal),
      ...REGISTRATION_EVENTS.map((name) =>
        getJson(this.#fetch, `${this.#routes.relay}/events?name=${name}&order=desc&limit=${PAGE_LIMIT}`, parse.relayEvents, signal),
      ),
    ]);
    return mergeById(pages);
  }
  getDailyStats(signal?: AbortSignal): Promise<DailyStats> {
    if (!this.recent) return Promise.reject(new Error("agrégats non servis par cette source (API-NEEDS.md § 9)"));
    return getJson(this.#fetch, `${this.#routes.relay}/stats/daily`, parse.dailyStats, signal);
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
  /** Le relais ne sert encore ni order=desc ni /stats/daily : listes des 500 premiers, agrégats non disponibles. */
  readonly recent = false;
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
  readonly recent = true;
  constructor(fetchFn: FetchLike = defaultFetch) {
    super({ relay: SIMULATION, vault: SIMULATION, response: SIMULATION }, fetchFn);
  }
  /** Tout est déjà étiqueté « simulation » : rien à demander. */
  getVaultOrigin(): Promise<VaultOrigin> {
    return Promise.resolve("sans-objet");
  }
}
