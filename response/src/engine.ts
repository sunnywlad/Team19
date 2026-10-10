// Service de réponse (specs/05) : réactions automatiques et rapports d'incident.
//
// Il réagit à deux sources :
//   - les entrées que la porte d'entrée écrit dans le journal (blocage,
//     schéma rejeté, débit dépassé, jeton invalide) ;
//   - les décisions du contrat, lues dans l'indexeur du relais.
//
// Quatre réactions, toutes bloquantes ou informatives : journal, quarantaine,
// pause de l'agent, alerte. Aucune ne déplace de fonds. Une pause ne se lève
// que par une décision humaine.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidateFunction } from "ajv/dist/2020.js";
import { loadSchema } from "./chain.ts";
import type { Entry } from "./chain.ts";
import { JournalError } from "./journal.ts";
import type { Clock, JournalStore } from "./journal.ts";
import { buildReport, reportSha256 } from "./report.ts";
import type { ActionName, Incident, IncidentReport, Trigger } from "./report.ts";

// Motifs du contrat (specs/02 § 7), classés par specs/05 § 3.
// Hostiles : une demande légitime ne les produit pas. Réponse complète dès la première fois.
const HOSTILE = new Set([1, 9, 15, 16]);
// Bénins : une erreur honnête les produit. Journal seul, incident à la répétition.
const BENIGN = new Set([2, 3, 5, 6, 17, 18, 19]);
// L'agent n'est pas authentifié, ou la file aurait dû arrêter la demande : alerte, sans pause.
const ALERT_ONLY = new Set([4, 14]);
// Cas 1 et ses suites : notification à l'approbateur.
const APPROVAL = new Set([10, 11, 12]);
// Rien à faire : accepté, approuvé, ou pause déjà en place.
const SILENT = new Set([0, 7, 8, 13]);

// specs/05 § 4 et specs/00, point p.
export const REPETITION_COUNT = 3;
export const REPETITION_WINDOW_S = 60;
export const QUEUE_ALERT_AFTER_MS = 15_000;
const EXCERPT_CHARS = 200;

/** Une décision du contrat, telle que l'indexeur du relais la rend (GET /decisions). */
export type IndexedDecision = {
  request_id: string;
  agent_id: string;
  client_id: string;
  action: number;
  decision: number;
  reason: number;
  ref_id: string;
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_timestamp: number;
};

/** Une ligne de la file du relais (GET /queue). */
export type QueueRow = { request_id: string; agent_id: string; client_id: string; status: string; enqueued_at_ms: number };

export type Pause = { agent_id: string; scope: "OFFCHAIN" | "ONCHAIN"; incident_id: string | null; paused_at_ms: number };

// Faits bruts envoyés à un humain. Jamais la justification rédigée par un
// agent, jamais un extrait du document.
export type Alert = {
  kind: "SECURITY" | "REPETITION" | "AVAILABILITY" | "APPROVAL_REQUESTED";
  recipients: string[];
  incident_id: string | null;
  request_id: string | null;
  agent_id: string | null;
  trigger: Trigger | null;
  reason_codes: string[];
  contract_reason: number | null;
};

export type EngineDeps = {
  store: JournalStore;
  clock: Clock;
  /** Mandat de chaque agent, pour la chaîne d'autorité du rapport. */
  mandates?: Map<string, ActionName[]>;
  defaultThreshold?: number;
  /** Dossier où la porte d'entrée gèle les documents bloqués. Lu seulement pour l'extrait. */
  quarantineDir?: string;
  /** Dossier où écrire les rapports. Absent : gardés en mémoire seulement. */
  reportsDir?: string;
  notify?: (alert: Alert) => void;
  newIncidentId?: () => string;
};

type OpenOptions = {
  trigger: Trigger;
  requestIds: string[];
  agentId: string;
  clientId: string;
  quarantine: boolean;
  reasonCodes: string[];
  contractReason: number | null;
};

const BYTES32 = /^0x[0-9a-f]{64}$/;

export class ResponseEngine {
  readonly #deps: EngineDeps;
  readonly #validateReport: ValidateFunction;
  readonly #incidents = new Map<string, Incident>();
  /** Toutes les générations, dans l'ordre. */
  readonly #reports: IncidentReport[] = [];
  /** agent -> niveau -> pause en vigueur. */
  readonly #pauses = new Map<string, Map<string, Pause>>();
  /** Refus bénins récents, par agent (secondes de bloc). */
  readonly #refusals = new Map<string, { at: number; requestId: string }[]>();
  /** Jetons invalides récents, toutes sources confondues (ms). */
  #invalidTokens: number[] = [];
  #replaying = false;

  constructor(deps: EngineDeps) {
    this.#deps = deps;
    this.#validateReport = loadSchema("incident-report.schema.json");
    this.#loadReports();
    // L'état des pauses se reconstruit depuis le journal : il est la référence.
    this.#replaying = true;
    for (const entry of deps.store.entries()) this.#track(entry);
    this.#replaying = false;
    deps.store.subscribe((entry) => this.#onEntry(entry));
  }

  #loadReports(): void {
    const dir = this.#deps.reportsDir;
    if (dir === undefined) return;
    mkdirSync(dir, { recursive: true });
    const loaded: IncidentReport[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const report = JSON.parse(readFileSync(join(dir, name), "utf8")) as IncidentReport;
        if (this.#validateReport(report)) loaded.push(report);
      } catch {
        // Fichier illisible : ignoré, le journal garde la trace de sa génération.
      }
    }
    loaded.sort((a, b) => a.generated_at_ms - b.generated_at_ms);
    for (const report of loaded) this.#remember(report);
  }

  #remember(report: IncidentReport): void {
    this.#reports.push(report);
    this.#incidents.set(report.incident_id, {
      incident_id: report.incident_id,
      trigger: report.trigger,
      request_ids: report.request_ids,
      agent_id: report.authority_chain.agent_id,
      client_id: report.authority_chain.client_id,
    });
  }

  // État dérivé du journal, que l'entrée vienne de nous ou d'un autre composant.
  #track(entry: Entry): void {
    if (entry.agent_id === null) return;
    if (entry.type === "AGENT_PAUSED") {
      const scope = entry.data["scope"] === "ONCHAIN" ? "ONCHAIN" : "OFFCHAIN";
      const levels = this.#pauses.get(entry.agent_id) ?? new Map<string, Pause>();
      if (!levels.has(scope)) {
        levels.set(scope, { agent_id: entry.agent_id, scope, incident_id: (entry.data["incident_id"] as string | null) ?? null, paused_at_ms: entry.ts_ms });
      }
      this.#pauses.set(entry.agent_id, levels);
    } else if (entry.type === "HUMAN_DECISION" && entry.data["decision"] === "AGENT_RESUMED") {
      this.#pauses.delete(entry.agent_id);
    }
  }

  #onEntry(entry: Entry): void {
    this.#track(entry);
    if (this.#replaying) return;

    if (entry.type === "HUMAN_DECISION") {
      // Après une décision humaine, le rapport est régénéré avec son auteur.
      const incident = this.#incidents.get(String(entry.data["incident_id"]));
      if (incident !== undefined) this.#generateReport(incident);
      return;
    }
    if (entry.component !== "GATEWAY") return;

    if (entry.type === "AUTH_REJECTED") {
      this.#onInvalidToken(entry);
      return;
    }
    if (entry.request_id === null || entry.agent_id === null || entry.client_id === null) return;
    const base = { requestIds: [entry.request_id], agentId: entry.agent_id, clientId: entry.client_id, contractReason: null };

    if (entry.type === "DETECTION" && entry.data["verdict"] === "BLOCK") {
      this.#open({ ...base, trigger: "DETECTOR_SCORE", quarantine: true, reasonCodes: entry.data["reason_codes"] as string[] });
    } else if (entry.type === "SCHEMA_REJECTED") {
      this.#open({ ...base, trigger: "SCHEMA_REJECTED", quarantine: true, reasonCodes: ["SCHEMA_INVALID"] });
    } else if (entry.type === "RATE_LIMITED") {
      // Pas de quarantaine : le contenu n'a pas été lu.
      this.#open({ ...base, trigger: "RATE_BURST", quarantine: false, reasonCodes: ["RATE_LIMITED"] });
    }
  }

  // Un jeton invalide ne met jamais personne en pause : personne n'est
  // authentifié, et n'importe qui pourrait sinon faire suspendre un agent en
  // usurpant son identifiant. À la répétition : une alerte.
  #onInvalidToken(entry: Entry): void {
    // Un agent en pause qui insiste n'est pas une attaque sur les jetons.
    if (entry.data["cause"] === "TOKEN_REVOKED") return;
    const at = (entry.data["received_at_ms"] as number | undefined) ?? entry.ts_ms;
    this.#invalidTokens = this.#invalidTokens.filter((t) => at - t < REPETITION_WINDOW_S * 1000);
    this.#invalidTokens.push(at);
    if (this.#invalidTokens.length < REPETITION_COUNT) return;
    this.#invalidTokens = [];
    this.#alert({ kind: "REPETITION", recipients: ["ANALYST"], incident_id: null, request_id: entry.request_id, agent_id: null, trigger: null, reason_codes: ["TOKEN_INVALID"], contract_reason: null }, entry.client_id);
  }

  #append(type: string, ids: { request_id: string | null; agent_id: string | null; client_id: string | null }, data: Record<string, unknown>, key?: string): Entry | null {
    const result = this.#deps.store.append({ type, component: "RESPONSE", ...ids, data }, key);
    if (result.duplicate) return null;
    return this.#deps.store.entries({ fromSeq: result.seq, limit: 1 })[0] ?? null;
  }

  #alert(alert: Alert, clientId: string | null, key?: string): void {
    const written = this.#append(
      "ALERT_SENT",
      { request_id: alert.request_id, agent_id: alert.agent_id, client_id: clientId },
      { incident_id: alert.incident_id, kind: alert.kind, recipients: alert.recipients },
      key,
    );
    if (written === null) return;
    // Une alerte qui ne part pas n'interrompt jamais le confinement.
    try {
      this.#deps.notify?.(alert);
    } catch {
      // l'entrée ALERT_SENT reste la trace de la tentative
    }
  }

  // Ordre de specs/05 § 5 : quarantaine, pause hors chaîne, alerte, rapport.
  #open(options: OpenOptions): Incident {
    const incident: Incident = {
      incident_id: this.#deps.newIncidentId?.() ?? `0x${randomBytes(32).toString("hex")}`,
      trigger: options.trigger,
      request_ids: options.requestIds,
      agent_id: options.agentId,
      client_id: options.clientId,
    };
    this.#incidents.set(incident.incident_id, incident);
    const ids = { request_id: options.requestIds[0] as string, agent_id: options.agentId, client_id: options.clientId };

    if (options.quarantine) {
      // L'empreinte du document vient de l'entrée d'arrivée. Le document
      // lui-même reste hors du journal.
      const received = this.#deps.store.entries({ requestId: ids.request_id }).find((e) => e.type === "REQUEST_RECEIVED");
      const sha = received?.data["document_sha256"];
      if (typeof sha === "string") this.#append("QUARANTINED", ids, { incident_id: incident.incident_id, document_sha256: sha });
    }
    if (!this.#pauses.get(options.agentId)?.has("OFFCHAIN")) {
      this.#append("AGENT_PAUSED", ids, { incident_id: incident.incident_id, scope: "OFFCHAIN", tx_hash: null });
    }
    this.#alert(
      {
        kind: "SECURITY",
        recipients: ["ANALYST", "TREASURER"],
        incident_id: incident.incident_id,
        request_id: ids.request_id,
        agent_id: options.agentId,
        trigger: options.trigger,
        reason_codes: options.reasonCodes,
        contract_reason: options.contractReason,
      },
      options.clientId,
    );
    this.#generateReport(incident);
    return incident;
  }

  #generateReport(incident: Incident): IncidentReport | null {
    const { store } = this.#deps;
    const report = buildReport(incident, {
      entries: store.entries(),
      head: store.head(),
      generatedAtMs: this.#deps.clock(),
      mandates: this.#deps.mandates ?? new Map(),
      defaultThreshold: this.#deps.defaultThreshold ?? 70,
    });
    if (!this.#validateReport(report)) {
      // Un rapport non conforme au schéma gelé n'est jamais publié.
      console.error(`réponse : rapport non conforme à specs/05 pour l'incident ${incident.incident_id}`);
      return null;
    }
    this.#append(
      "INCIDENT_REPORT_GENERATED",
      { request_id: incident.request_ids[0] as string, agent_id: incident.agent_id, client_id: incident.client_id },
      { incident_id: incident.incident_id, report_sha256: reportSha256(report), journal_head_seq: report.journal_head.seq, journal_head_hash: report.journal_head.hash },
    );
    this.#reports.push(report);
    if (this.#deps.reportsDir !== undefined) {
      writeFileSync(join(this.#deps.reportsDir, `${incident.incident_id}-${report.journal_head.seq}.json`), JSON.stringify(report, null, 2), "utf8");
    }
    return report;
  }

  // Une décision du contrat, lue dans l'indexeur. Elle est recopiée dans le
  // journal (DECISION_OBSERVED), puis traitée selon son motif. La source de
  // vérité reste la chaîne.
  observeDecision(d: IndexedDecision): void {
    const ids = { request_id: d.request_id, agent_id: d.agent_id, client_id: d.client_id };
    let observed: Entry | null;
    try {
      observed = this.#append(
        "DECISION_OBSERVED",
        ids,
        { decision: d.decision, reason: d.reason, action: d.action, ref_id: d.ref_id, tx_hash: d.tx_hash, block_number: d.block_number, block_timestamp: d.block_timestamp, log_index: d.log_index },
        // Un même événement relu (redémarrage, nouvelle interrogation) n'est traité qu'une fois.
        `DECISION_OBSERVED:${d.tx_hash}:${d.log_index}`,
      );
    } catch (error) {
      if (!(error instanceof JournalError) || error.code !== "INVALID_ENTRY") throw error;
      // Décision que le schéma du journal ne sait pas décrire : traitée comme un refus inconnu.
      this.#alert({ kind: "SECURITY", recipients: ["ANALYST"], incident_id: null, request_id: BYTES32.test(d.request_id) ? d.request_id : null, agent_id: null, trigger: null, reason_codes: [], contract_reason: null }, null);
      return;
    }
    if (observed === null) return;
    const base = { agentId: d.agent_id, clientId: d.client_id, reasonCodes: [], contractReason: d.reason };

    if (HOSTILE.has(d.reason)) {
      this.#open({ ...base, trigger: "CONTRACT_REFUSAL", requestIds: [d.request_id], quarantine: true });
    } else if (BENIGN.has(d.reason)) {
      // Fenêtre glissante mesurée sur l'horodatage du bloc.
      const recent = (this.#refusals.get(d.agent_id) ?? []).filter((r) => d.block_timestamp - r.at < REPETITION_WINDOW_S);
      recent.push({ at: d.block_timestamp, requestId: d.request_id });
      if (recent.length >= REPETITION_COUNT && !this.#pauses.get(d.agent_id)?.has("OFFCHAIN")) {
        this.#refusals.delete(d.agent_id);
        const others = recent.map((r) => r.requestId).filter((id) => id !== d.request_id);
        // Pas de quarantaine : aucun de ces documents n'est jugé hostile.
        this.#open({ ...base, trigger: "REPEATED_REFUSALS", requestIds: [d.request_id, ...new Set(others)], quarantine: false });
      } else {
        this.#refusals.set(d.agent_id, recent);
      }
    } else if (APPROVAL.has(d.reason)) {
      this.#alert({ kind: "APPROVAL_REQUESTED", recipients: ["APPROVER"], incident_id: null, request_id: d.request_id, agent_id: d.agent_id, trigger: null, reason_codes: [], contract_reason: d.reason }, d.client_id);
    } else if (ALERT_ONLY.has(d.reason) || !SILENT.has(d.reason)) {
      // Signature invalide, fenêtre invalide ou code inconnu : alerte, sans pause.
      this.#alert({ kind: "SECURITY", recipients: ["ANALYST"], incident_id: null, request_id: d.request_id, agent_id: d.agent_id, trigger: null, reason_codes: [], contract_reason: d.reason }, d.client_id);
    }
  }

  // Disponibilité : une demande qui attend trop en file, ou qui y expire.
  // Alerte vers l'exploitation. Aucune pause, aucun incident de sécurité.
  checkQueue(rows: QueueRow[]): void {
    const now = this.#deps.clock();
    for (const row of rows) {
      const waiting = (row.status === "PENDING" || row.status === "SUBMITTING") && now - row.enqueued_at_ms > QUEUE_ALERT_AFTER_MS;
      if (!waiting && row.status !== "EXPIRED") continue;
      this.#alert(
        { kind: "AVAILABILITY", recipients: ["OPERATIONS"], incident_id: null, request_id: row.request_id, agent_id: row.agent_id, trigger: null, reason_codes: [], contract_reason: null },
        row.client_id,
        `ALERT_SENT:AVAILABILITY:${row.request_id}`,
      );
    }
  }

  // Mode démo uniquement, après l'archivage du journal : les rapports sont
  // archivés eux aussi, et l'état repart de zéro comme le journal.
  reset(stamp: string): string | null {
    let archive: string | null = null;
    const dir = this.#deps.reportsDir;
    if (dir !== undefined && existsSync(dir)) {
      archive = `${dir}.${stamp}.bak`;
      renameSync(dir, archive);
      mkdirSync(dir, { recursive: true });
    }
    this.#incidents.clear();
    this.#reports.length = 0;
    this.#pauses.clear();
    this.#refusals.clear();
    this.#invalidTokens = [];
    return archive;
  }

  /** Pauses en vigueur, une ligne par niveau. */
  pausedAgents(): Pause[] {
    return [...this.#pauses.values()].flatMap((levels) => [...levels.values()]);
  }

  isPaused(agentId: string): boolean {
    return this.#pauses.has(agentId);
  }

  /** Toutes les générations de rapports, avec l'extrait du document gelé s'il existe. */
  incidents(): { report: IncidentReport; quarantine_excerpt: string | null }[] {
    return this.#reports.map((report) => ({ report, quarantine_excerpt: this.#excerpt(report.request_ids[0] as string) }));
  }

  // Début du document mis en quarantaine par la porte d'entrée. C'est un
  // contenu hostile : borné, jamais interprété, jamais écrit dans le journal.
  #excerpt(requestId: string): string | null {
    const dir = this.#deps.quarantineDir;
    if (dir === undefined || !BYTES32.test(requestId)) return null;
    try {
      const stored = JSON.parse(readFileSync(join(dir, `${requestId}.json`), "utf8")) as { document?: unknown };
      return typeof stored.document === "string" ? stored.document.slice(0, EXCERPT_CHARS) : null;
    } catch {
      return null;
    }
  }
}
