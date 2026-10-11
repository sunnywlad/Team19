import { Amount, ClockTag, OpaqueId } from "../components/atoms.tsx";
import { Panel } from "../components/Panel.tsx";
import { pendingCases } from "../domain/activity.ts";
import { actionLabel } from "../domain/reasons.ts";
import { formatRemaining, formatTime } from "../lib/format.ts";
import { vaultFed, type ViewProps } from "./shared.ts";

/**
 * Cas en attente d'un humain (décision 1). Seuls les faits inscrits au contrat
 * sont montrés : la référence, le montant, le bénéficiaire, l'échéance. La
 * justification rédigée par un agent n'est jamais affichée, et rien ici ne
 * permet d'approuver ou de refuser.
 */
export function PendingView({ view }: { view: ViewProps }) {
  const { relay, sources, vaultOrigin, now } = view;
  return (
    <Panel title="Cas en attente d'une validation humaine" id="titre-attente" source={vaultFed(sources.relay, vaultOrigin)} snapshot={relay} now={now}>
      {(data) => {
        const cases = pendingCases(data.decisions, data.events);
        return (
          <>
            <p className="discret">
              Faits inscrits au contrat, lus dans ses événements. La justification rédigée par un agent n'est jamais affichée. L'approbation se
              fait ailleurs, avec la clé de l'approbateur : cette page ne peut ni approuver ni refuser.
            </p>
            {cases.length === 0 ? (
              <p className="vide">Aucun cas en attente.</p>
            ) : (
              <ul className="cas">
                {cases.map((c) => {
                  const remaining = c.deadline === null ? null : c.deadline - Math.floor(now / 1000);
                  return (
                    <li key={c.requestId} data-testid="cas-en-attente">
                      <dl className="fiche">
                        <div>
                          <dt>{c.action === 2 ? "Placement" : "Facture"}</dt>
                          <dd data-testid="cas-reference">
                            <OpaqueId value={c.refId} /> <span className="discret">· {actionLabel(c.action)}</span>
                          </dd>
                        </div>
                        <div>
                          <dt>Montant bloqué</dt>
                          <dd data-testid="cas-montant">
                            <Amount wei={c.amountWei} />
                          </dd>
                        </div>
                        <div>
                          <dt>Bénéficiaire inscrit</dt>
                          <dd data-testid="cas-beneficiaire">
                            <OpaqueId value={c.beneficiaryId} missing="non disponible" />
                          </dd>
                        </div>
                        <div>
                          <dt>Délai restant</dt>
                          <dd data-testid="cas-delai">
                            {remaining === null ? (
                              <span className="indisponible">non disponible</span>
                            ) : remaining > 0 ? (
                              <strong>{formatRemaining(remaining)}</strong>
                            ) : (
                              <strong>échéance dépassée : sans réponse humaine, la demande est refusée</strong>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Échéance</dt>
                          <dd>
                            {c.deadline === null ? <span className="indisponible">non disponible</span> : formatTime(c.deadline * 1000)}{" "}
                            <ClockTag clock="bloc" />
                          </dd>
                        </div>
                        <div>
                          <dt>Demande</dt>
                          <dd>
                            <OpaqueId value={c.requestId} /> <span className="discret">· bloc {c.blockNumber}</span>
                          </dd>
                        </div>
                      </dl>
                      <p className="discret">
                        Délai restant estimé : l'échéance est en heure de bloc, comparée ici à l'horloge locale du navigateur.
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        );
      }}
    </Panel>
  );
}
