import { Amount, ClockTag, OpaqueId } from "../components/atoms.tsx";
import { CountdownRing } from "../components/CountdownRing.tsx";
import { Icon } from "../components/icons.tsx";
import { Panel } from "../components/Panel.tsx";
import { pendingCases, type PendingCase } from "../domain/activity.ts";
import { actionLabel } from "../domain/reasons.ts";
import { formatRemaining, formatTime } from "../lib/format.ts";
import type { VaultOrigin } from "../api/types.ts";
import { vaultFed, type ViewProps } from "./shared.ts";

/** Identifiant de demande tel que demo/human.mjs l'accepte. Hors format : aucune commande n'est écrite. */
const REQUEST_ID = /^0x[0-9a-f]{64}$/;

/** Ce que la commande fera, selon ce que le relais a derrière lui. */
function commandNote(origin: VaultOrigin): string {
  if (origin === "chaine") return "Contrat sur un réseau de test local : la commande appelle le contrat avec la clé de l'approbateur.";
  return "demo/human.mjs n'agit qu'en VAULT_MODE=chain, contre le contrat. Avec le coffre simulé, le geste passe par le port de contrôle du faux coffre (relay/src/demo-control.ts).";
}

/**
 * Le geste humain, écrit pour être copié dans un terminal. Le dashboard ne
 * détient aucune clé et n'émet que des GET : il ne peut pas l'exécuter.
 */
function SignCommand({ c, now, origin }: { c: PendingCase; now: number; origin: VaultOrigin }) {
  if (!REQUEST_ID.test(c.requestId)) {
    return <p className="indisponible">Identifiant de demande hors format : aucune commande n'est proposée.</p>;
  }
  const expired = c.deadline !== null && c.deadline - Math.floor(now / 1000) <= 0;
  const lines = expired ? ["expire"] : ["approve", "refuse"];
  return (
    <section className="signature" aria-label="À signer par l'approbateur">
      <h3>
        <Icon name="cle" /> À signer par l'approbateur
      </h3>
      <p className="discret">
        Depuis la racine du dépôt, avec <code>APPROVER_PRIVATE_KEY</code> dans l'environnement du shell. La clé n'est jamais lue ni affichée ici.
      </p>
      <ul className="commandes">
        {lines.map((verb) => (
          <li key={verb}>
            <span className="commande-verbe">
              {verb === "approve" ? "Approuver : payer le montant bloqué au bénéficiaire inscrit" : verb === "refuse" ? "Refuser : clore en refus" : "Échéance dépassée : clore en refus (délai)"}
            </span>
            <code className="commande" data-testid={`commande-${verb}`}>
              node demo/human.mjs {verb} {c.requestId}
            </code>
          </li>
        ))}
      </ul>
      <p className="discret">{commandNote(origin)} La décision se lit ensuite dans l'événement Decision, sur cette page.</p>
    </section>
  );
}

/**
 * Cas en attente d'un humain (décision 1). Seuls les faits inscrits au contrat
 * sont montrés : la référence, le montant, le bénéficiaire, l'échéance. La
 * justification rédigée par un agent n'est jamais affichée, et rien ici ne
 * permet d'approuver ou de refuser.
 */
export function PendingView({ view }: { view: ViewProps }) {
  const { relay, sources, vaultOrigin, now } = view;
  return (
    <Panel title="Cas en attente d'une validation humaine" id="titre-attente" source={vaultFed(sources.relay, vaultOrigin)} snapshot={relay} now={now} className="panneau-validation">
      {(data) => {
        const cases = pendingCases(data.decisions, data.events);
        return (
          <>
            <p className="discret">
              Faits inscrits au contrat, lus dans ses événements. La justification rédigée par un agent n'est jamais affichée. L'approbation se
              fait ailleurs, avec la clé de l'approbateur : cette page ne peut ni approuver ni refuser.
            </p>
            {cases.length === 0 ? (
              <p className="vide">
                <Icon name="passe" /> Aucun cas en attente.
              </p>
            ) : (
              <ul className="cas">
                {cases.map((c) => {
                  const remaining = c.deadline === null ? null : c.deadline - Math.floor(now / 1000);
                  return (
                    <li key={c.requestId} data-testid="cas-en-attente" className="cas-ligne">
                      <CountdownRing deadline={c.deadline} decidedAt={c.blockTimestamp} now={now} />
                      <div className="cas-corps">
                        <p className="cas-reste" data-testid="cas-delai">
                          <Icon name="attente" />{" "}
                          {remaining === null ? (
                            <span className="indisponible">délai non disponible</span>
                          ) : remaining > 0 ? (
                            <>
                              <strong className="nombre">{formatRemaining(remaining)}</strong>
                              <span className="discret"> avant refus automatique</span>
                            </>
                          ) : (
                            <strong>échéance dépassée : sans réponse humaine, la demande est refusée</strong>
                          )}
                        </p>
                        <dl className="fiche cas-faits">
                          <div>
                            <dt>Montant inscrit, bloqué</dt>
                            <dd data-testid="cas-montant" className="cas-gros">
                              <Amount wei={c.amountWei} />
                            </dd>
                          </div>
                          <div>
                            <dt>Bénéficiaire inscrit</dt>
                            <dd data-testid="cas-beneficiaire" className="cas-gros">
                              <OpaqueId value={c.beneficiaryId} missing="non disponible" />
                            </dd>
                          </div>
                          <div>
                            <dt>{c.action === 2 ? "Placement" : "Facture"}</dt>
                            <dd data-testid="cas-reference">
                              <OpaqueId value={c.refId} /> <span className="discret">· {actionLabel(c.action)}</span>
                            </dd>
                          </div>
                          <div>
                            <dt>Échéance</dt>
                            <dd>
                              {c.deadline === null ? <span className="indisponible">non disponible</span> : <span className="nombre">{formatTime(c.deadline * 1000)}</span>}{" "}
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
                          Délai restant estimé : l'échéance est en heure de bloc, comparée ici à l'horloge locale du navigateur. L'anneau part du
                          bloc de la décision et se vide jusqu'à l'échéance.
                        </p>
                        <SignCommand c={c} now={now} origin={vaultOrigin} />
                      </div>
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
