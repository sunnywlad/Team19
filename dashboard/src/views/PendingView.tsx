import { Amount, ClockTag, OpaqueId } from "../components/atoms.tsx";
import { Panel } from "../components/Panel.tsx";
import { Echeance } from "../components/veto/Echeance.tsx";
import { approverAlertAt, pendingCases } from "../domain/activity.ts";
import { actionLabel } from "../domain/reasons.ts";
import { sameWorld, vaultFed, type ViewProps } from "./shared.ts";

/**
 * Cas en attente d'un humain (décision 1). Seuls les faits inscrits au contrat
 * sont montrés : la référence, le montant, le bénéficiaire, l'échéance. La
 * justification rédigée par un agent n'est jamais affichée, et rien ici ne
 * permet d'approuver ou de refuser.
 */
export function PendingView({ view }: { view: ViewProps }) {
  const { relay, response, sources, vaultOrigin, now } = view;
  // Le journal ne se rapproche des demandes du relais que s'ils sont du même monde.
  const journal = sameWorld(sources) ? (response.data?.journal ?? null) : null;
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
                {cases.map((c) => (
                    <li key={c.requestId} data-testid="cas-en-attente" className="cas-ligne">
                      <div className="cas-echeance" data-testid="cas-delai">
                        <Echeance
                          deadline={c.deadline}
                          decidedAt={c.blockTimestamp}
                          now={now}
                          notifiedAtMs={journal === null ? null : approverAlertAt(c.requestId, journal)}
                        />
                      </div>
                      <div className="cas-corps">
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
                            <dt>Horloge de l'échéance</dt>
                            <dd>
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
                          Temps restant estimé : l'échéance est en heure de bloc, comparée ici à l'horloge locale du navigateur. La jauge part du
                          bloc de la décision et se vide jusqu'à l'échéance, une case pour un vingt-quatrième du délai.
                        </p>
                      </div>
                    </li>
                ))}
              </ul>
            )}
          </>
        );
      }}
    </Panel>
  );
}
