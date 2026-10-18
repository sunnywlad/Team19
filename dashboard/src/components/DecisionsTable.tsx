import type { RelayDecision, RelayEvent } from "../api/types.ts";
import { amountFor, eventKey, newestFirst } from "../domain/activity.ts";
import { REASON_SIGNATURE_INVALID, actionLabel, readDecision } from "../domain/reasons.ts";
import { formatTime } from "../lib/format.ts";
import { Nom } from "./Affichage.tsx";
import { Amount, DecisionBadge, OpaqueId } from "./atoms.tsx";

export type Reaction = { available: true; labels: string[] } | { available: false; why: string };

type Props = {
  decisions: RelayDecision[];
  events: RelayEvent[];
  /** Réaction du service de réponse pour une demande. */
  reactionFor: (requestId: string) => Reaction;
};

export function ReactionCell({ reaction }: { reaction: Reaction }) {
  if (!reaction.available) return <span className="indisponible">{reaction.why}</span>;
  if (reaction.labels.length === 0) return <span>aucune (journal seul)</span>;
  return <span>{reaction.labels.join(", ")}</span>;
}

/**
 * Décisions du contrat, lues dans les événements Decision indexés : jamais dans
 * le statut d'un reçu. Une ligne par événement (clé : transaction et index).
 */
export function DecisionsTable({ decisions, events, reactionFor }: Props) {
  if (decisions.length === 0) return <p className="vide">Aucune décision du contrat pour l'instant.</p>;
  return (
    <div className="defilement" role="region" aria-label="Décisions du contrat" tabIndex={0}>
      <table className="tableau decisions">
        <thead>
          <tr>
            <th scope="col">Décision</th>
            <th scope="col">Motif</th>
            <th scope="col">Montant</th>
            <th scope="col">Agent</th>
            <th scope="col">Référence</th>
            <th scope="col">Bloc</th>
            <th scope="col">Transaction</th>
            <th scope="col">Réponse déclenchée</th>
          </tr>
        </thead>
        <tbody>
          {newestFirst(decisions).map((d) => {
            const read = readDecision(d);
            const amount = amountFor(d, events);
            return (
              <tr key={eventKey(d)} className={`ligne-${read.kind}`} data-testid="decision">
                <td data-label="Décision">
                  <DecisionBadge kind={read.kind} />
                </td>
                <td data-label="Motif">
                  <span className="synthese">{read.summary}</span>
                  <span className="discret"> · {actionLabel(d.action)}</span>
                </td>
                <td data-label="Montant">
                  {amount === null ? (
                    <span className="discret">aucun montant sorti</span>
                  ) : (
                    <>
                      <Amount wei={amount.wei} /> <span className="discret">{amount.kind === "paye" ? "payé" : "bloqué"}</span>
                    </>
                  )}
                </td>
                <td data-label="Agent">
                  {d.reason === REASON_SIGNATURE_INVALID ? (
                    // specs/02 § 8 : l'agent d'une demande non authentifiée n'est pas un fait.
                    <span className="discret">non authentifié</span>
                  ) : (
                    <Nom id={d.agent_id} genre="agent" />
                  )}
                </td>
                <td data-label="Référence">
                  <Nom id={d.ref_id} />
                </td>
                <td data-label="Bloc">
                  {d.block_number} <span className="discret">· {formatTime(d.block_timestamp * 1000)}</span>
                </td>
                <td data-label="Transaction">
                  <OpaqueId value={d.tx_hash} />
                </td>
                <td data-label="Réponse déclenchée">
                  <ReactionCell reaction={reactionFor(d.request_id)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
