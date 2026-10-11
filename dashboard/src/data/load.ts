// Trois familles de données, chacune interrogée et datée séparément : le relais
// peut répondre quand le service de réponse est coupé, et l'inverse.
import type { ApiClient } from "../api/client.ts";
import type {
  IncidentItem,
  JournalEntry,
  JournalVerification,
  PausedAgent,
  QueueRow,
  RelayDecision,
  RelayEvent,
  RelayStatus,
} from "../api/types.ts";

export type RelayData = { status: RelayStatus; decisions: RelayDecision[]; events: RelayEvent[]; queue: QueueRow[] };

export type ResponseData = {
  incidents: IncidentItem[];
  journal: JournalEntry[];
  verification: JournalVerification;
  pausedAgents: PausedAgent[];
};

export async function loadRelay(client: ApiClient, signal: AbortSignal): Promise<RelayData> {
  const [status, decisions, events, queue] = await Promise.all([
    client.getRelayStatus(signal),
    client.getDecisions(signal),
    client.getEvents(signal),
    client.getQueue(signal),
  ]);
  return { status, decisions, events, queue };
}

export async function loadResponse(client: ApiClient, signal: AbortSignal): Promise<ResponseData> {
  const [incidents, journal, verification, pausedAgents] = await Promise.all([
    client.getIncidents(signal),
    client.getJournalEntries(signal),
    client.getJournalVerification(signal),
    client.getPausedAgents(signal),
  ]);
  return { incidents, journal, verification, pausedAgents };
}
