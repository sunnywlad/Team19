// Monde simulé : ce que serviraient le relais, le coffre et le service de
// réponse. Aucune règle métier n'est rejouée ici : chaque scénario ÉCRIT les
// faits attendus par specs/acceptance/scenarios.md, à des instants donnés.
// Les identifiants sont ceux de specs/examples/fixtures.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AutomaticAction,
  DetectorReasonCode,
  IncidentItem,
  IncidentReport,
  IncidentTrigger,
  JournalEntry,
  JournalVerification,
  PausedAgent,
  QueueRow,
  QueueStatus,
  RelayDecision,
  RelayEvent,
  RelayStatus,
  VaultState,
} from "../src/api/types.ts";

type FixtureFile = { unit_wei: string; ids: Record<string, string> };
const FIXTURES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../specs/examples/fixtures.json"), "utf8")) as FixtureFile;

export const IDS: Record<string, string> = FIXTURES.ids;
const UNIT = BigInt(FIXTURES.unit_wei);

const sha256 = (data: string | Buffer): Buffer => createHash("sha256").update(data).digest();
/** Identifiant opaque reproductible, propre aux fixtures du dashboard. */
export const fixtureId = (label: string): string => `0x${sha256(`argent-intelligent/dashboard-fixture/v1/${label}`).toString("hex")}`;
export const units = (n: number): string => (BigInt(n) * UNIT).toString();
const id = (label: string): string => {
  const value = IDS[label];
  if (!value) throw new Error(`fixture inconnue : ${label}`);
  return value;
};

const ADDRESS = "0x2294022049feaae4987f70d940af08735d4af542";
const REASON_NAMES = [
  "NONE", "INVOICE_UNKNOWN", "INVOICE_ALREADY_PAID", "REQUEST_REPLAYED", "SIGNATURE_INVALID", "REQUEST_EXPIRED",
  "EXCEEDS_PLACEABLE", "VAULT_PAUSED", "AGENT_PAUSED", "AGENT_NOT_AUTHORIZED", "ABOVE_THRESHOLD", "APPROVAL_TIMEOUT",
  "APPROVAL_REFUSED", "APPROVED", "VALIDITY_WINDOW_INVALID", "ACTION_UNKNOWN", "PLACEMENT_UNKNOWN",
  "PLACEMENT_ALREADY_EXECUTED", "REF_PENDING_APPROVAL", "INSUFFICIENT_CASH",
];

/** Forme canonique (RFC 8785 réduite aux entiers, chaînes, tableaux, objets) : specs/04 § 4. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type World = {
  status: RelayStatus;
  events: RelayEvent[];
  queue: QueueRow[];
  vault: VaultState;
  incidents: IncidentItem[];
  journal: JournalEntry[];
  verification: JournalVerification;
  pausedAgents: PausedAgent[];
};

type Who = { request_id: string | null; agent_id: string | null; client_id: string | null };
type Tx = { txHash: string; blockNumber: number; blockTimestamp: number };
type VaultNumbers = { cash: number; debts: number; reserve: number; held: number; heldPlacements: number; placeable: number };

export type IncidentInput = {
  label: string;
  trigger: IncidentTrigger;
  requestId: string;
  agentId: string;
  score: number | null;
  codes: DetectorReasonCode[];
  receivedAtMs: number;
  detectedAtMs: number;
  observedAtMs: number | null;
  contract: IncidentReport["contract"];
  signed: boolean;
  exposedWei: string | null;
  excerpt: string | null;
};

export class Sim {
  readonly events: RelayEvent[] = [];
  readonly queue: QueueRow[] = [];
  readonly journal: JournalEntry[] = [];
  readonly incidents: IncidentItem[] = [];
  readonly pausedAgents: PausedAgent[] = [];
  verification: JournalVerification["verification"] = null;
  vault: VaultNumbers = { cash: 0, debts: 0, reserve: 0, held: 0, heldPlacements: 0, placeable: 0 };
  #block = 1000;
  #blockTimestamp = 1;
  #tx = 0;
  readonly #open = new Map<string, { input: IncidentInput; actions: IncidentReport["automatic_actions"]; pausedAtMs: number; alertedAtMs: number }>();

  /** Une transaction : un bloc, des événements. */
  tx(atMs: number, logs: [string, Record<string, string | number | boolean>][]): Tx {
    this.#block += 1;
    this.#tx += 1;
    this.#blockTimestamp = Math.floor(atMs / 1000);
    const txHash = fixtureId(`tx/${this.#tx}`);
    logs.forEach(([name, args], logIndex) => {
      this.events.push({
        id: this.events.length + 1,
        name,
        tx_hash: txHash,
        log_index: logIndex,
        block_number: this.#block,
        block_timestamp: this.#blockTimestamp,
        request_id: typeof args.requestId === "string" ? args.requestId : null,
        args,
      });
    });
    return { txHash, blockNumber: this.#block, blockTimestamp: this.#blockTimestamp };
  }

  /** Une entrée de journal, chaînée comme le veut specs/04 § 4. */
  log(atMs: number, type: string, component: JournalEntry["component"], who: Who, data: Record<string, unknown>): number {
    const seq = this.journal.length;
    const prev = this.journal[seq - 1]?.hash ?? "0".repeat(64);
    const body = { v: 1 as const, seq, ts_ms: atMs, type, component, ...who, data };
    const hash = sha256(Buffer.concat([Buffer.from(canonical(body), "utf8"), Buffer.from(prev, "hex")])).toString("hex");
    this.journal.push({ ...body, prev_hash: prev, hash });
    return seq;
  }

  #row(requestId: string): QueueRow {
    const row = [...this.queue].reverse().find((r) => r.request_id === requestId);
    if (!row) throw new Error("demande absente de la file");
    return row;
  }

  setQueue(atMs: number, requestId: string, status: QueueStatus, extra: { txHash?: string; cause?: string } = {}): void {
    const row = this.#row(requestId);
    row.status = status;
    row.updated_at_ms = atMs;
    if (extra.txHash) row.tx_hash = extra.txHash;
    if (extra.cause) row.cause = extra.cause;
  }

  enqueue(atMs: number, requestId: string, agentId: string): void {
    const expiresAt = Math.floor(atMs / 1000) + 30;
    this.log(atMs, "ENQUEUED", "QUEUE", { request_id: requestId, agent_id: agentId, client_id: id("C-DEMO") }, { expires_at: expiresAt });
    this.queue.push({
      id: this.queue.length + 1,
      request_id: requestId,
      agent_id: agentId,
      client_id: id("C-DEMO"),
      expires_at: expiresAt,
      status: "PENDING",
      enqueued_at_ms: atMs,
      updated_at_ms: atMs,
      attempts: 0,
      tx_hash: null,
      cause: null,
    });
  }

  /** Parcours nominal jusqu'à la mise en file (sans SUBMITTED). */
  nominal(atMs: number, requestId: string, agentId: string, action: "PAY_INVOICE" | "PLACE", refId: string, score: number): void {
    const who = { request_id: requestId, agent_id: agentId, client_id: id("C-DEMO") };
    this.log(atMs + 1, "REQUEST_RECEIVED", "GATEWAY", who, { received_at_ms: atMs, document_sha256: sha256(`doc/${requestId}`).toString("hex") });
    this.log(atMs + 44, "DETECTION", "GATEWAY", who, {
      score, threshold: 70, verdict: "PASS", reason_codes: [], received_at_ms: atMs, detected_at_ms: atMs + 43, detector_version: "regles-0.1",
    });
    this.log(atMs + 47, "REQUEST_PARSED", "GATEWAY", who, { action, ref_id: refId });
    this.log(atMs + 49, "FORWARDED_TO_CLIENT_AI", "GATEWAY", who, {});
    const issuedAt = Math.floor(atMs / 1000);
    this.log(atMs + 900, "REQUEST_SIGNED", "CLIENT_AI", who, {
      action, ref_id: refId, issued_at: issuedAt, expires_at: issuedAt + 30, signer: ADDRESS, request_digest: fixtureId(`digest/${requestId}`),
    });
    this.enqueue(atMs + 910, requestId, agentId);
  }

  /** Le relais soumet, le contrat décide : événement Decision et événements liés. */
  decide(
    atMs: number,
    requestId: string,
    agentId: string,
    action: number,
    refId: string,
    decision: number,
    reason: number,
    extra: [string, Record<string, string | number | boolean>][] = [],
  ): Tx {
    const tx = this.tx(atMs, [["Decision", { requestId, agentId, clientId: id("C-DEMO"), action, decision, reason, refId }], ...extra]);
    if (this.queue.some((r) => r.request_id === requestId)) {
      this.setQueue(atMs, requestId, "SUBMITTED", { txHash: tx.txHash });
      this.log(atMs, "SUBMITTED", "RELAY", { request_id: requestId, agent_id: agentId, client_id: id("C-DEMO") }, { tx_hash: tx.txHash });
    }
    return tx;
  }

  /** Le service de réponse lit la décision dans l'indexeur et la recopie au journal. */
  observe(atMs: number, requestId: string, agentId: string): RelayEvent {
    const event = [...this.events].reverse().find((e) => e.name === "Decision" && e.request_id === requestId);
    if (!event) throw new Error("aucune décision à observer");
    this.log(atMs, "DECISION_OBSERVED", "RESPONSE", { request_id: requestId, agent_id: agentId, client_id: id("C-DEMO") }, {
      decision: event.args.decision, reason: event.args.reason, action: event.args.action, ref_id: event.args.refId,
      tx_hash: event.tx_hash, block_number: event.block_number, block_timestamp: event.block_timestamp, log_index: event.log_index,
    });
    return event;
  }

  alert(atMs: number, who: Who, kind: string, recipients: string[], incidentId: string | null = null): number {
    return this.log(atMs, "ALERT_SENT", "RESPONSE", who, { incident_id: incidentId, kind, recipients });
  }

  #report(atMs: number, key: string): void {
    const open = this.#open.get(key);
    if (!open) throw new Error("incident inconnu");
    const { input } = open;
    const incidentId = fixtureId(`incident/${input.label}`);
    const head = this.journal[this.journal.length - 1];
    if (!head) throw new Error("journal vide");
    const reportSeq = this.journal.length;
    const actions = [...open.actions.filter((a) => a.action !== "REPORT"), { action: "REPORT" as AutomaticAction, at_ms: atMs, journal_seq: reportSeq }];
    open.actions = actions;
    const report: IncidentReport = {
      report_version: 1,
      incident_id: incidentId,
      generated_at_ms: atMs,
      trigger: input.trigger,
      request_ids: [input.requestId],
      authority_chain: {
        agent_id: input.agentId,
        agent_mandate: ["PAY_INVOICE"],
        client_id: id("C-DEMO"),
        client_signer: input.signed ? ADDRESS : null,
        request_digest: input.signed ? fixtureId(`digest/${input.requestId}`) : null,
        relay_tx_hash: input.contract ? input.contract.tx_hash : null,
      },
      timestamps: {
        received_at_ms: input.receivedAtMs,
        detected_at_ms: input.detectedAtMs,
        observed_at_ms: input.observedAtMs,
        paused_at_ms: open.pausedAtMs,
        alerted_at_ms: open.alertedAtMs,
      },
      detector: { score: input.score, threshold: 70, reason_codes: input.codes },
      contract: input.contract,
      amounts: { exposed_wei: input.exposedWei, out_wei: "0" },
      automatic_actions: actions,
      human_decision: null,
      journal_head: { seq: head.seq, hash: head.hash },
    };
    const who = { request_id: input.requestId, agent_id: input.agentId, client_id: id("C-DEMO") };
    this.log(atMs, "INCIDENT_REPORT_GENERATED", "RESPONSE", who, {
      incident_id: incidentId,
      report_sha256: sha256(canonical(report)).toString("hex"),
      journal_head_seq: head.seq,
      journal_head_hash: head.hash,
    });
    this.incidents.push({ report, quarantine_excerpt: input.excerpt });
  }

  /** Réponse complète de specs/05 § 3 : quarantaine, pause hors chaîne, alerte, rapport. */
  respond(atMs: number, input: IncidentInput): void {
    const incidentId = fixtureId(`incident/${input.label}`);
    const who = { request_id: input.requestId, agent_id: input.agentId, client_id: id("C-DEMO") };
    const quarantine = this.log(atMs + 6, "QUARANTINED", "RESPONSE", who, {
      incident_id: incidentId, document_sha256: sha256(`doc/${input.requestId}`).toString("hex"),
    });
    const pause = this.log(atMs + 11, "AGENT_PAUSED", "RESPONSE", who, { incident_id: incidentId, scope: "OFFCHAIN", tx_hash: null });
    const alert = this.alert(atMs + 20, who, "SECURITY", ["ANALYST", "TREASURER"], incidentId);
    this.pausedAgents.push({ agent_id: input.agentId, scope: "OFFCHAIN", incident_id: incidentId, paused_at_ms: atMs + 11 });
    this.#open.set(input.label, {
      input,
      pausedAtMs: atMs + 11,
      alertedAtMs: atMs + 20,
      actions: [
        { action: "QUARANTINE", at_ms: atMs + 6, journal_seq: quarantine },
        { action: "AGENT_PAUSE_OFFCHAIN", at_ms: atMs + 11, journal_seq: pause },
        { action: "ALERT", at_ms: atMs + 20, journal_seq: alert },
      ],
    });
    this.#report(atMs + 39, input.label);
  }

  /** Plus tard : la pause est confirmée sur la chaîne, le rapport est régénéré. */
  pauseOnChain(atMs: number, label: string): void {
    const open = this.#open.get(label);
    if (!open) throw new Error("incident inconnu");
    const { input } = open;
    const incidentId = fixtureId(`incident/${input.label}`);
    const tx = this.tx(atMs, [["AgentPaused", { agentId: input.agentId, by: ADDRESS }]]);
    const seq = this.log(atMs + 1500, "AGENT_PAUSED", "RESPONSE", { request_id: input.requestId, agent_id: input.agentId, client_id: id("C-DEMO") }, {
      incident_id: incidentId, scope: "ONCHAIN", tx_hash: tx.txHash,
    });
    this.pausedAgents.push({ agent_id: input.agentId, scope: "ONCHAIN", incident_id: incidentId, paused_at_ms: atMs + 1500 });
    open.actions = [...open.actions, { action: "AGENT_PAUSE_ONCHAIN", at_ms: atMs + 1500, journal_seq: seq }];
    this.#report(atMs + 1520, label);
  }

  /** Le script de vérification a tourné sur le journal (specs/04 § 5), sans tête de référence. */
  verify(atMs: number): void {
    const head = this.journal[this.journal.length - 1];
    this.verification = {
      verified_at_ms: atMs,
      result: "OK",
      defect: null,
      defect_seq: null,
      entries: this.journal.length,
      head_seq: head ? head.seq : null,
      head_hash: head ? head.hash : null,
      expected_head_checked: false,
    };
  }

  snapshot(): World {
    const head = this.journal[this.journal.length - 1];
    const v = this.vault;
    return {
      status: { next_block: String(this.#block + 1), confirmations: 1, events: this.events.length },
      events: this.events,
      queue: this.queue,
      vault: {
        block_number: this.#block,
        block_timestamp: this.#blockTimestamp,
        cash_wei: units(v.cash),
        admitted_debts_wei: units(v.debts),
        safety_reserve_wei: units(v.reserve),
        total_held_wei: units(v.held),
        held_placements_wei: units(v.heldPlacements),
        placeable_wei: units(v.placeable),
        threshold_wei: units(25),
        vault_paused: false,
      },
      incidents: this.incidents,
      journal: this.journal,
      verification: { head: head ? { seq: head.seq, hash: head.hash } : null, verification: this.verification },
      pausedAgents: this.pausedAgents,
    };
  }
}

/** Décisions telles que les sert l'indexeur (relay/src/indexer.ts, toDecision). */
export function toDecisions(events: RelayEvent[]): RelayDecision[] {
  return events
    .filter((e) => e.name === "Decision")
    .map((e) => {
      const decision = Number(e.args.decision);
      const reason = Number(e.args.reason);
      const reasonName = REASON_NAMES[reason] ?? null;
      return {
        id: e.id,
        request_id: String(e.args.requestId),
        agent_id: String(e.args.agentId),
        client_id: String(e.args.clientId),
        action: Number(e.args.action),
        decision,
        reason,
        reason_name: reasonName,
        effective_decision: reasonName === null || (decision !== 1 && decision !== 2) ? 0 : decision,
        ref_id: String(e.args.refId),
        tx_hash: e.tx_hash,
        log_index: e.log_index,
        block_number: e.block_number,
        block_timestamp: e.block_timestamp,
      };
    });
}

export { id as fixture, ADDRESS };
