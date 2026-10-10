// Rapport d'incident (specs/05 § 2), prérempli depuis le journal. L'outil
// prépare le dossier : il ne classe pas l'incident et ne notifie aucune autorité.
// Aucun champ libre : ni commentaire, ni justification, ni extrait de document.
import { createHash } from "node:crypto";
import { canonical } from "./chain.ts";
import type { Entry, Head } from "./chain.ts";

export type Trigger = "DETECTOR_SCORE" | "SCHEMA_REJECTED" | "CONTRACT_REFUSAL" | "RATE_BURST" | "REPEATED_REFUSALS";
export type ActionName = "PAY_INVOICE" | "PLACE";
export type AutomaticAction = "QUARANTINE" | "AGENT_PAUSE_OFFCHAIN" | "AGENT_PAUSE_ONCHAIN" | "ALERT" | "REPORT";

export type Incident = {
  incident_id: string;
  trigger: Trigger;
  /** La première est la demande déclenchante. */
  request_ids: string[];
  agent_id: string;
  client_id: string;
};

export type IncidentReport = {
  report_version: 1;
  incident_id: string;
  generated_at_ms: number;
  trigger: Trigger;
  request_ids: string[];
  authority_chain: {
    agent_id: string;
    agent_mandate: ActionName[];
    client_id: string;
    client_signer: string | null;
    request_digest: string | null;
    relay_tx_hash: string | null;
  };
  timestamps: {
    received_at_ms: number;
    detected_at_ms: number;
    observed_at_ms: number | null;
    paused_at_ms: number | null;
    alerted_at_ms: number | null;
  };
  detector: { score: number | null; threshold: number; reason_codes: string[] };
  contract: { decision: number; reason: number; tx_hash: string; block_number: number; block_timestamp: number } | null;
  amounts: { exposed_wei: string | null; out_wei: string };
  automatic_actions: { action: AutomaticAction; at_ms: number; journal_seq: number }[];
  human_decision: { decision: string; author_role: string; author_id: string; at_ms: number; journal_seq: number } | null;
  journal_head: { seq: number; hash: string };
};

export type ReportContext = {
  /** Tout le journal, dans l'ordre de seq. */
  entries: Entry[];
  /** Tête du journal avant l'entrée INCIDENT_REPORT_GENERATED de ce rapport. */
  head: Head;
  generatedAtMs: number;
  mandates: Map<string, ActionName[]>;
  defaultThreshold: number;
};

/** Empreinte d'un rapport : SHA-256 de sa forme canonique (JCS), comme dans les exemples de specs/. */
export function reportSha256(report: IncidentReport): string {
  return createHash("sha256").update(canonical(report), "utf8").digest("hex");
}

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function buildReport(incident: Incident, context: ReportContext): IncidentReport {
  if (context.head.seq === null) throw new Error("journal vide : aucun rapport possible");
  const trigger = incident.request_ids[0] as string;
  const ofRequest = context.entries.filter((e) => e.request_id === trigger);
  const ofIncident = context.entries.filter((e) => e.data["incident_id"] === incident.incident_id);
  const first = (list: Entry[], type: string): Entry | undefined => list.find((e) => e.type === type);
  const last = (list: Entry[], type: string): Entry | undefined => list.findLast((e) => e.type === type);

  const received = first(ofRequest, "REQUEST_RECEIVED") ?? first(ofRequest, "RATE_LIMITED");
  const detection = first(ofRequest, "DETECTION");
  const schemaRejected = ofRequest.find((e) => e.type === "SCHEMA_REJECTED" && e.component === "GATEWAY");
  const rateLimited = first(ofRequest, "RATE_LIMITED");
  const signed = first(ofRequest, "REQUEST_SIGNED");
  const submitted = first(ofRequest, "SUBMITTED");
  // La décision qui compte est la dernière observée : un cas 1 peut finir en 0 ou en 2.
  const decision = last(ofRequest, "DECISION_OBSERVED");
  const pausedOffchain = ofIncident.find((e) => e.type === "AGENT_PAUSED" && e.data["scope"] === "OFFCHAIN");
  const alerted = first(ofIncident, "ALERT_SENT");
  const human = last(ofIncident, "HUMAN_DECISION");

  const byContract = incident.trigger === "CONTRACT_REFUSAL" || incident.trigger === "REPEATED_REFUSALS";
  const blockTimestamp = num(decision?.data["block_timestamp"]);
  // Détection par le contrat : l'horodatage du bloc, à la seconde. Sinon, la
  // fin du traitement par la porte d'entrée.
  const detectedAt =
    byContract && blockTimestamp !== null
      ? blockTimestamp * 1000
      : (num(detection?.data["detected_at_ms"]) ??
        num(rateLimited?.data["received_at_ms"]) ??
        schemaRejected?.ts_ms ??
        (ofRequest[0]?.ts_ms as number));
  const receivedAt = num(received?.data["received_at_ms"]) ?? Math.min(detectedAt, ofRequest[0]?.ts_ms ?? detectedAt);

  const reasonCodes = Array.isArray(detection?.data["reason_codes"]) ? [...(detection.data["reason_codes"] as string[])] : [];
  if (schemaRejected !== undefined && !reasonCodes.includes("SCHEMA_INVALID")) reasonCodes.push("SCHEMA_INVALID");
  if (rateLimited !== undefined && detection === undefined) reasonCodes.push("RATE_LIMITED");

  const automatic: IncidentReport["automatic_actions"] = [];
  for (const e of ofIncident) {
    if (e.type === "QUARANTINED") automatic.push({ action: "QUARANTINE", at_ms: e.ts_ms, journal_seq: e.seq });
    else if (e.type === "AGENT_PAUSED") {
      automatic.push({ action: e.data["scope"] === "ONCHAIN" ? "AGENT_PAUSE_ONCHAIN" : "AGENT_PAUSE_OFFCHAIN", at_ms: e.ts_ms, journal_seq: e.seq });
    } else if (e.type === "ALERT_SENT") automatic.push({ action: "ALERT", at_ms: e.ts_ms, journal_seq: e.seq });
    else if (e.type === "INCIDENT_REPORT_GENERATED") automatic.push({ action: "REPORT", at_ms: e.ts_ms, journal_seq: e.seq });
  }
  // Ce rapport-ci : son entrée de journal sera la suivante.
  automatic.push({ action: "REPORT", at_ms: context.generatedAtMs, journal_seq: context.head.seq + 1 });

  return {
    report_version: 1,
    incident_id: incident.incident_id,
    generated_at_ms: context.generatedAtMs,
    trigger: incident.trigger,
    request_ids: [...incident.request_ids],
    authority_chain: {
      agent_id: incident.agent_id,
      agent_mandate: context.mandates.get(incident.agent_id) ?? [],
      client_id: incident.client_id,
      client_signer: str(signed?.data["signer"]),
      request_digest: str(signed?.data["request_digest"]),
      relay_tx_hash: str(submitted?.data["tx_hash"]),
    },
    timestamps: {
      received_at_ms: receivedAt,
      detected_at_ms: detectedAt,
      observed_at_ms: byContract ? (decision?.ts_ms ?? null) : null,
      paused_at_ms: pausedOffchain?.ts_ms ?? null,
      alerted_at_ms: alerted?.ts_ms ?? null,
    },
    detector: {
      score: num(detection?.data["score"]),
      threshold: num(detection?.data["threshold"]) ?? context.defaultThreshold,
      reason_codes: reasonCodes,
    },
    contract:
      decision === undefined
        ? null
        : {
            decision: decision.data["decision"] as number,
            reason: decision.data["reason"] as number,
            tx_hash: decision.data["tx_hash"] as string,
            block_number: decision.data["block_number"] as number,
            block_timestamp: decision.data["block_timestamp"] as number,
          },
    // Le service de réponse ne lit pas les registres du contrat : le montant
    // inscrit n'est pas connu ici. Un incident naît toujours d'un blocage ou
    // d'un refus, donc rien n'est sorti.
    amounts: { exposed_wei: null, out_wei: "0" },
    automatic_actions: automatic,
    human_decision:
      human === undefined
        ? null
        : {
            decision: human.data["decision"] as string,
            author_role: human.data["author_role"] as string,
            author_id: human.data["author_id"] as string,
            at_ms: human.ts_ms,
            journal_seq: human.seq,
          },
    journal_head: { seq: context.head.seq, hash: context.head.hash },
  };
}
