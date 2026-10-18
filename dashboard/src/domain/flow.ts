// Le chemin qu'une demande a pris dans notre flux, lu dans les données déjà
// servies : événements Decision du relais, entrées du journal du service de
// réponse. Rien n'est inventé : une étape sans trace reste « non atteinte » ou
// « non disponible », jamais cochée par déduction.
//
//   Agent → Porte d'entrée → IA du client → Relais → Contrat
//         → Validation humaine (cas 1) ou Paiement (cas 2)
//   Branche latérale : Réponse (quarantaine, pause hors chaîne, alerte, rapport)
import type { IncidentItem, JournalEntry, RelayDecision } from "../api/types.ts";
import { latestIncidents } from "./activity.ts";
import { CLOSING_REASONS, REASONS, readDecision } from "./reasons.ts";

export type FlowNode = "agent" | "porte" | "ia" | "relais" | "contrat" | "humain" | "paiement" | "reponse";
export type FlowEdge =
  | "agent-porte"
  | "porte-ia"
  | "ia-relais"
  | "relais-contrat"
  | "contrat-humain"
  | "contrat-paiement"
  | "humain-paiement"
  | "porte-reponse"
  | "contrat-reponse";

/** Couleur du chemin : vert payé, ambre humain, rouge refusé, gris bloqué à la porte. */
export type Tone = "accepte" | "humain" | "refuse" | "bloque";

export const TONE_WORDS: Record<Tone, string> = {
  accepte: "Accepté",
  humain: "Validation humaine",
  refuse: "Refusé",
  bloque: "Bloqué à la porte",
};

export const NODE_LABELS: Record<FlowNode, string> = {
  agent: "Agent",
  porte: "Porte d'entrée",
  ia: "IA du client",
  relais: "Relais",
  contrat: "Contrat",
  humain: "Validation humaine",
  paiement: "Paiement",
  reponse: "Réponse",
};

export type Outcome = {
  /** Unique par issue : transaction et index pour le contrat, rang du journal pour la porte. */
  key: string;
  source: "contrat" | "porte";
  tone: Tone;
  requestId: string | null;
  /** Ligne de synthèse, au féminin : « la demande est ... ». */
  summary: string;
  /** Code de ce qui a tranché : nom du motif du contrat, ou type de l'arrêt à la porte. null s'il est inconnu. */
  code: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Le service de réponse a réagi à cette demande (incident qui la cite). */
  reacted: boolean;
  /** Rang dans sa propre source : bloc et index, ou rang du journal. Jamais comparé d'une source à l'autre. */
  order: [number, number];
};

const TO_CONTRACT: FlowEdge[] = ["agent-porte", "porte-ia", "ia-relais", "relais-contrat"];
const TO_CONTRACT_NODES: FlowNode[] = ["agent", "porte", "ia", "relais", "contrat"];
const REASON_APPROVED = 13;

/** Une demande citée par un incident a déclenché la réponse. */
function citedBy(requestId: string | null, incidents: IncidentItem[] | null): boolean {
  if (requestId === null || incidents === null) return false;
  return latestIncidents(incidents).some((i) => i.report.request_ids.includes(requestId));
}

/**
 * Chemin d'une décision du contrat. « incidents » vaut null quand le service de
 * réponse n'est pas du même monde que le relais : la branche Réponse reste éteinte.
 */
export function contractOutcome(d: RelayDecision, incidents: IncidentItem[] | null): Outcome {
  const read = readDecision(d);
  const nodes = [...TO_CONTRACT_NODES];
  const edges = [...TO_CONTRACT];
  // Approbation, refus de l'approbateur, délai dépassé : la demande est passée par la validation humaine.
  const viaHuman = read.kind === "humain" || (read.reasonKnown && read.downgraded === null && CLOSING_REASONS.has(d.reason));
  if (viaHuman) {
    nodes.push("humain");
    edges.push("contrat-humain");
  }
  if (read.kind === "accepte") {
    if (viaHuman && d.reason === REASON_APPROVED) edges.push("humain-paiement");
    else edges.push("contrat-paiement");
    nodes.push("paiement");
  }
  const reacted = citedBy(d.request_id, incidents);
  if (reacted) {
    nodes.push("reponse");
    edges.push("contrat-reponse");
  }
  return {
    key: `contrat:${d.tx_hash}:${d.log_index}`,
    source: "contrat",
    tone: read.kind,
    requestId: d.request_id,
    summary: read.summary,
    code: read.reasonKnown ? (REASONS[d.reason]?.name ?? null) : null,
    nodes,
    edges,
    reacted,
    order: [d.block_number, d.log_index],
  };
}

const GATEWAY_STOPS: Record<string, string> = {
  AUTH_REJECTED: "rejetée à l'entrée",
  RATE_LIMITED: "rejetée à l'entrée : limite de débit dépassée",
  SCHEMA_REJECTED: "rejetée par le schéma strict",
};

const CODE = /^[A-Z][A-Z0-9_]{1,40}$/;

/** Premier code de raison du détecteur s'il a la forme d'un code, sinon le type de l'entrée. */
function gatewayCode(entry: JournalEntry): string {
  const codes: unknown = entry.data["reason_codes"];
  const first: unknown = Array.isArray(codes) ? codes[0] : undefined;
  return typeof first === "string" && CODE.test(first) ? first : entry.type;
}

/** Arrêt à la porte d'entrée, lu dans le journal. null : l'entrée n'est pas un arrêt. */
export function gatewayOutcome(entry: JournalEntry, incidents: IncidentItem[] | null): Outcome | null {
  const blocked = entry.type === "DETECTION" && entry.data.verdict === "BLOCK";
  const summary = blocked ? "bloquée à la porte d'entrée" : GATEWAY_STOPS[entry.type];
  if (summary === undefined) return null;
  const reacted = citedBy(entry.request_id, incidents);
  return {
    key: `porte:${entry.seq}`,
    source: "porte",
    tone: "bloque",
    requestId: entry.request_id,
    summary,
    code: gatewayCode(entry),
    nodes: reacted ? ["agent", "porte", "reponse"] : ["agent", "porte"],
    edges: reacted ? ["agent-porte", "porte-reponse"] : ["agent-porte"],
    reacted,
    order: [entry.seq, 0],
  };
}

export type Outcomes = { contract: Outcome[]; gateway: Outcome[] };

const byOrder = (a: Outcome, b: Outcome): number => a.order[0] - b.order[0] || a.order[1] - b.order[1];

/**
 * Toutes les issues connues, chaque source dans son ordre propre, du plus ancien
 * au plus récent. « linked » : relais et service de réponse sont du même monde.
 */
export function allOutcomes(decisions: RelayDecision[] | null, journal: JournalEntry[] | null, incidents: IncidentItem[] | null, linked: boolean): Outcomes {
  const known = linked ? incidents : null;
  const contract = (decisions ?? []).map((d) => contractOutcome(d, known)).sort(byOrder);
  const gateway = (journal ?? [])
    .map((e) => gatewayOutcome(e, incidents))
    .filter((o): o is Outcome => o !== null)
    .sort(byOrder);
  return { contract, gateway };
}

/**
 * Issue montrée à l'ouverture de la page : la dernière décision du contrat, sinon
 * le dernier arrêt à la porte. Les deux sources ont des horloges différentes : on
 * ne les compare pas entre elles.
 */
export function initialOutcome(outcomes: Outcomes): Outcome | null {
  return outcomes.contract.at(-1) ?? outcomes.gateway.at(-1) ?? null;
}

export type StepState = "fait" | "echec" | "attente" | "non-atteint" | "inconnu";

export const STEP_STATE_WORDS: Record<StepState, string> = {
  fait: "fait",
  echec: "échec",
  attente: "en attente",
  "non-atteint": "non atteint",
  inconnu: "non disponible",
};

export type Step = { key: string; label: string; state: StepState; atMs: number | null };

type StepRule = { key: string; label: string; done: (e: JournalEntry) => boolean; failed: (e: JournalEntry) => boolean };

/** Étapes 1 à 8 de specs/README.md qui écrivent au journal, dans l'ordre de la spec. */
const JOURNAL_STEPS: StepRule[] = [
  { key: "entree", label: "Authentifiée", done: (e) => e.type === "REQUEST_RECEIVED", failed: (e) => e.type === "AUTH_REJECTED" || e.type === "RATE_LIMITED" },
  {
    key: "detecteur",
    label: "Testée par le détecteur",
    done: (e) => e.type === "DETECTION" && e.data.verdict === "PASS",
    failed: (e) => e.type === "DETECTION" && e.data.verdict === "BLOCK",
  },
  { key: "schema", label: "Schéma strict", done: (e) => e.type === "REQUEST_PARSED", failed: (e) => e.type === "SCHEMA_REJECTED" },
  { key: "ia", label: "Transmise à l'IA du client", done: (e) => e.type === "FORWARDED_TO_CLIENT_AI", failed: () => false },
  { key: "signee", label: "Signée par le client", done: (e) => e.type === "REQUEST_SIGNED", failed: () => false },
  { key: "file", label: "En file", done: (e) => e.type === "ENQUEUED", failed: (e) => e.type === "QUEUE_EXPIRED" },
  { key: "soumise", label: "Soumise par le relais", done: (e) => e.type === "SUBMITTED", failed: () => false },
];

/**
 * Frise d'une demande : chaque étape cochée seulement si le journal l'atteste.
 * « journal » vaut null quand il n'est pas lisible pour cette demande (service
 * de réponse simulé face à un relais réel) : les étapes du journal sont alors
 * « non disponible ».
 */
export function requestSteps(outcome: Outcome, journal: JournalEntry[] | null): Step[] {
  const mine = journal === null || outcome.requestId === null ? null : journal.filter((e) => e.request_id === outcome.requestId);
  // Une porte qui arrête une demande sans identifiant : seule son entrée est connue.
  const own = journal?.find((e) => outcome.source === "porte" && `porte:${e.seq}` === outcome.key) ?? null;
  const entries = mine ?? (own ? [own] : null);
  const steps: Step[] = [];
  let stopped = false;
  for (const rule of JOURNAL_STEPS) {
    if (entries === null) {
      steps.push({ key: rule.key, label: rule.label, state: "inconnu", atMs: null });
      continue;
    }
    const failed = entries.find(rule.failed);
    const done = entries.find(rule.done);
    if (stopped) steps.push({ key: rule.key, label: rule.label, state: "non-atteint", atMs: null });
    else if (failed) {
      steps.push({ key: rule.key, label: rule.label, state: "echec", atMs: failed.ts_ms });
      stopped = true;
    } else if (done) steps.push({ key: rule.key, label: rule.label, state: "fait", atMs: done.ts_ms });
    else steps.push({ key: rule.key, label: rule.label, state: outcome.source === "porte" ? "non-atteint" : "inconnu", atMs: null });
  }
  if (outcome.source === "porte") {
    steps.push({ key: "contrat", label: "Décidée par le contrat", state: "non-atteint", atMs: null });
    return steps;
  }
  // Décision du contrat. Passée par la validation humaine : le contrat a d'abord décidé 1, ce n'est pas un échec.
  const viaHuman = outcome.nodes.includes("humain");
  steps.push({ key: "contrat", label: "Décidée par le contrat", state: !viaHuman && outcome.tone === "refuse" ? "echec" : "fait", atMs: null });
  if (viaHuman) {
    const state: StepState = outcome.tone === "humain" ? "attente" : outcome.tone === "accepte" ? "fait" : "echec";
    steps.push({ key: "humain", label: "Validation humaine", state, atMs: null });
  }
  return steps;
}
