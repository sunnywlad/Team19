// Relais : lit la file et soumet les demandes signées au coffre. Il ne crée
// aucune demande, ne détient aucun fonds et ne décide de rien. Dans le doute,
// il n'envoie pas : une panne vaut refus.
import type { AlertSink } from "./alerts.ts";
import type { Policy } from "./config.ts";
import type { JournalClient } from "./journal.ts";
import type { PauseSource } from "./pauses.ts";
import type { Queue } from "./queue.ts";
import { checkValidityWindow } from "./schema.ts";
import { toSeconds, type Clock } from "./types.ts";
import type { SubmitOutcome, VaultClient } from "./vault.ts";

export type RelayDeps = {
  queue: Queue;
  vault: VaultClient;
  journal: JournalClient;
  alerts: AlertSink;
  pauses: PauseSource;
  policy: Policy;
  clock: Clock;
};

export type TickReport = { submitted: number; rejected: number; deferred: number; inDoubt: number; expired: number };

export class Relay {
  readonly #deps: RelayDeps;
  constructor(deps: RelayDeps) {
    this.#deps = deps;
  }

  /** Un tour : entretien de la file, puis une tentative par demande en attente. */
  async tick(): Promise<TickReport> {
    const { queue, vault, journal, alerts, pauses, policy, clock } = this.#deps;
    const report: TickReport = { submitted: 0, rejected: 0, deferred: 0, inDoubt: 0, expired: 0 };
    report.expired = (await queue.sweep()).expired;

    for (const row of queue.pending()) {
      const entry = queue.payload(row.id);
      if (!entry) {
        // Le contenu ne correspond plus à ce qui est entré : on ne soumet pas.
        queue.markRejected(row.id, "PAYLOAD_ALTERED");
        await journal.append({
          type: "SCHEMA_REJECTED",
          component: "RELAY",
          request_id: row.request_id,
          agent_id: null,
          client_id: null,
          data: { error_count: 1 },
        });
        report.rejected += 1;
        continue;
      }
      const { request } = entry;

      const defect = checkValidityWindow(request, toSeconds(clock()), policy);
      if (defect === "REQUEST_EXPIRED") continue; // Le prochain entretien la marque expirée.
      if (defect) {
        queue.markRejected(row.id, defect);
        report.rejected += 1;
        continue;
      }

      if (policy.relayRefusesPausedAgents) {
        let paused: boolean;
        try {
          paused = await pauses.isPaused(request.agent_id);
        } catch {
          // Impossible de savoir : on n'envoie pas. La demande attend, puis expire.
          queue.markNotSent(row.id, "état de pause inconnu");
          report.deferred += 1;
          break;
        }
        if (paused) {
          queue.markRejected(row.id, "AGENT_PAUSED");
          report.rejected += 1;
          continue;
        }
      }

      // L'intention est écrite avant l'envoi : si le processus s'arrête ici,
      // la reprise classe la demande « dans le doute » au lieu de la renvoyer.
      queue.markSubmitting(row.id);
      let outcome: SubmitOutcome;
      try {
        outcome = await vault.submit(request);
      } catch {
        outcome = { kind: "unknown", cause: "erreur pendant la soumission", txHash: null };
      }

      if (outcome.kind === "sent") {
        queue.markSubmitted(row.id, outcome.txHash);
        report.submitted += 1;
        await journal.append({
          type: "SUBMITTED",
          component: "RELAY",
          request_id: request.request_id,
          agent_id: request.agent_id,
          client_id: request.client_id,
          data: { tx_hash: outcome.txHash },
        });
      } else if (outcome.kind === "not_sent") {
        queue.markNotSent(row.id, outcome.cause);
        report.deferred += 1;
        break; // Le coffre est injoignable : inutile d'insister ce tour-ci.
      } else {
        // L'identifiant a pu être consommé : aucun renvoi automatique.
        queue.markInDoubt(row.id, outcome.cause, outcome.txHash);
        report.inDoubt += 1;
        await alerts.availability({
          kind: "SUBMISSION_IN_DOUBT",
          request_id: request.request_id,
          agent_id: request.agent_id,
          waited_s: toSeconds(clock() - row.enqueued_at_ms),
        });
      }
    }
    return report;
  }
}
