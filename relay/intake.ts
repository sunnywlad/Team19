// Réception d'une demande de décision (étapes 6 et 7) : validation stricte,
// mise en file, et une entrée de journal à chaque issue.
import type { Journal } from "../response/journal.ts";
import { pseudonymize } from "../response/pseudonym.ts";
import type { RequestQueue } from "./queue.ts";
import { ID_PATTERN, parseRequest } from "./request.ts";

export type IntakeDeps = {
  queue: RequestQueue;
  journal: Journal;
  pseudonymKey: string;
  now?: () => Date;
};

export type IntakeResult =
  | { status: "accepted"; request_id: string }
  | { status: "rejected"; errors: string[] }
  | { status: "duplicate"; request_id: string };

const ACTOR = "file";

export function receiveDecisionRequest(raw: unknown, deps: IntakeDeps): IntakeResult {
  const nowSeconds = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const parsed = parseRequest(raw, nowSeconds);

  if (!parsed.ok) {
    // On ne journalise que les motifs, jamais le contenu reçu. L'identifiant
    // n'est repris que s'il a la forme attendue.
    const candidate = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["request_id"] : null;
    deps.journal.append({
      step: "ERREUR",
      actor: ACTOR,
      request_id: typeof candidate === "string" && ID_PATTERN.test(candidate) ? candidate : null,
      data: { stage: "6_DECISION_DEMANDEE", errors: parsed.errors },
    });
    return { status: "rejected", errors: parsed.errors };
  }

  const { request } = parsed;
  const origin = {
    agent: pseudonymize(request.agent_id, deps.pseudonymKey),
    client: pseudonymize(request.client_id, deps.pseudonymKey),
  };

  if (!deps.queue.enqueue(request, nowSeconds)) {
    deps.journal.append({
      step: "ERREUR",
      actor: ACTOR,
      request_id: request.request_id,
      data: { ...origin, stage: "7_FILE_ENTREE", errors: ["identifiant de demande déjà reçu (rejeu)"] },
    });
    return { status: "duplicate", request_id: request.request_id };
  }

  deps.journal.append({
    step: "6_DECISION_DEMANDEE",
    actor: ACTOR,
    request_id: request.request_id,
    data: { ...origin, action: request.action, expires_at: request.expires_at },
  });
  deps.journal.append({ step: "7_FILE_ENTREE", actor: ACTOR, request_id: request.request_id });
  return { status: "accepted", request_id: request.request_id };
}

// Passe les demandes jamais soumises à EXPIRED et le consigne. À appeler
// périodiquement : c'est ce qui rend visible un relais en panne.
export function expireStale(deps: Pick<IntakeDeps, "queue" | "journal" | "now">): string[] {
  const nowSeconds = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const expired = deps.queue.expire(nowSeconds);
  for (const requestId of expired) {
    deps.journal.append({
      step: "ERREUR",
      actor: ACTOR,
      request_id: requestId,
      data: { stage: "7_FILE_ENTREE", errors: ["demande expirée avant soumission au contrat"] },
    });
  }
  return expired;
}
