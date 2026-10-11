// « Action humaine requise » : les demandes que le contrat a renvoyées à un
// humain (décision 1), avec le compte à rebours jusqu'à l'échéance inscrite
// dans HoldPlaced. Rien ici n'approuve : un bouton ne fait que changer de vue.
import { pendingCases } from "../domain/activity.ts";
import { actionLabel } from "../domain/reasons.ts";
import { formatRemaining, formatTime } from "../lib/format.ts";
import { vaultFed, type ViewProps } from "../views/shared.ts";
import { Amount, ClockTag, OpaqueId } from "./atoms.tsx";
import { CountdownRing } from "./CountdownRing.tsx";
import { Icon } from "./icons.tsx";
import { Panel } from "./Panel.tsx";

type Props = {
  view: ViewProps;
  /** Ouvre la page Validation. */
  onOpenValidation: () => void;
  /** Montre la demande à la table ronde. Absent : pas de bouton. */
  onShow?: (requestId: string) => void;
};

/** Temps restant en mots, à partir de l'échéance en heure de bloc. */
export function remainingText(deadline: number | null, now: number): string {
  if (deadline === null) return "échéance non disponible";
  const remaining = deadline - Math.floor(now / 1000);
  return remaining > 0 ? formatRemaining(remaining) : "échéance dépassée";
}

export function HumanAction({ view, onOpenValidation, onShow }: Props) {
  const { relay, sources, vaultOrigin, now } = view;
  const cases = relay.data ? pendingCases(relay.data.decisions, relay.data.events) : [];
  const urgent = cases.length > 0;
  return (
    <Panel
      title={urgent ? `Action humaine requise · ${cases.length}` : "Action humaine requise"}
      id="titre-action-humaine"
      source={vaultFed(sources.relay, vaultOrigin)}
      snapshot={relay}
      now={now}
      // La seule lueur de la page : ce qui attend un humain.
      className={urgent ? "action-humaine action-humaine-requise" : "action-humaine action-humaine-calme"}
    >
      {(data) => {
        const list = data === relay.data ? cases : pendingCases(data.decisions, data.events);
        if (list.length === 0) {
          return (
            <p className="vide" data-testid="action-humaine-vide">
              <Icon name="passe" /> Aucune demande n'attend un humain.
            </p>
          );
        }
        return (
          <ul className="attente-liste" aria-label="Demandes en validation humaine">
            {list.map((c) => {
              const remaining = remainingText(c.deadline, now);
              return (
                <li key={c.requestId} className="attente-ligne" data-testid="action-humaine-cas">
                  <CountdownRing deadline={c.deadline} decidedAt={c.blockTimestamp} now={now} />
                  <div className="attente-faits">
                    <p className="attente-reste">
                      <Icon name="attente" /> <span className="nombre" data-testid="action-humaine-reste">{remaining}</span>
                      <span className="discret"> avant refus automatique</span>
                    </p>
                    <dl className="attente-fiche">
                      <div>
                        <dt>Montant inscrit</dt>
                        <dd>
                          <Amount wei={c.amountWei} />
                        </dd>
                      </div>
                      <div>
                        <dt>Bénéficiaire inscrit</dt>
                        <dd>
                          <OpaqueId value={c.beneficiaryId} missing="non disponible" />
                        </dd>
                      </div>
                      <div>
                        <dt>{c.action === 2 ? "Placement" : "Facture"}</dt>
                        <dd>
                          <OpaqueId value={c.refId} /> <span className="discret">· {actionLabel(c.action)}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Échéance</dt>
                        <dd>
                          {c.deadline === null ? <span className="indisponible">—</span> : <span className="nombre">{formatTime(c.deadline * 1000)}</span>}{" "}
                          <ClockTag clock="bloc" />
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="attente-gestes">
                    {onShow && (
                      <button type="button" className="bouton-lien" data-ui="navigation" onClick={() => onShow(c.requestId)}>
                        Voir à la table
                      </button>
                    )}
                    <button type="button" className="bouton-plein" data-ui="navigation" onClick={onOpenValidation}>
                      Ouvrir Validation
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        );
      }}
    </Panel>
  );
}
