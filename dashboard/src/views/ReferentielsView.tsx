// Référentiels et règles : ce que le contrat a inscrit, en lecture seule. Rien
// ici ne se modifie : une inscription ou un paramètre se change dans le contrat,
// par le rôle qui en a la clé, hors de cette console.
import { Nom, libelleOf } from "../components/Affichage.tsx";
import { Amount, ClockTag, Details, OpaqueId, Vide } from "../components/atoms.tsx";
import { Icon } from "../components/icons.tsx";
import { Panel } from "../components/Panel.tsx";
import { AgentStatusPill, Pastille } from "../components/pills.tsx";
import { agentsRetenus, fournisseursRetenus, trouvailles } from "../domain/recherche.ts";
import { agentRows, beneficiaryRows, formatDelay, mandateWords, rulesOf, type Setting } from "../domain/referentiels.ts";
import { useAffichage } from "../hooks/useAffichage.ts";
import { formatDateTime } from "../lib/format.ts";
import { sameWorld, vaultFed, type ViewProps } from "./shared.ts";

function ReadOnlyNote({ children }: { children: string }) {
  return (
    <p className="bandeau-info" role="note">
      <Icon name="info" />
      <span>{children}</span>
    </p>
  );
}

type Filtre = { query: string; onClear: () => void };

/** Ce que la recherche de la barre haute retient, et de quoi l'effacer. */
function FiltreNote({ query, shown, total, onClear }: Filtre & { shown: number; total: number }) {
  return (
    <p className="filtre-note" role="status" data-testid="filtre-note">
      {shown} sur {total} pour « {query.trim()} »
      <button type="button" className="lien" data-ui="affichage" onClick={onClear}>
        Effacer la recherche
      </button>
    </p>
  );
}

export function FournisseursView({ view, query = "", onClear = () => undefined }: { view: ViewProps } & Partial<Filtre>) {
  const { relay, sources, vaultOrigin, now } = view;
  const { libelles } = useAffichage();
  return (
    <>
      <ReadOnlyNote>
        Fournisseurs inscrits au contrat (BeneficiaryRegistered). Un fournisseur s'inscrit par le rôle d'admission du contrat, avec sa clé, hors
        de cette console : aucun bouton ici ne l'ajoute ni ne le modifie.
      </ReadOnlyNote>
      <Panel title="Fournisseurs inscrits" id="titre-fournisseurs" source={vaultFed(sources.relay, vaultOrigin)} famille="relay" snapshot={relay} now={now} className="carte-liste">
        {(data) => {
          const all = beneficiaryRows(data.events);
          if (all.length === 0)
            return (
              <Vide className="carte-vide" hint="Un fournisseur apparaît ici dès son inscription au contrat, avec ses factures.">
                Aucun fournisseur inscrit au contrat.
              </Vide>
            );
          const kept = fournisseursRetenus(trouvailles(data.events, libelles), query);
          const rows = kept === null ? all : all.filter((r) => kept.has(r.beneficiaryId));
          return (
            <>
            {kept !== null && <FiltreNote query={query} shown={rows.length} total={all.length} onClear={onClear} />}
            {rows.length === 0 ? (
              <Vide className="carte-vide">Aucun fournisseur ni aucune facture ne correspond à « {query.trim()} ».</Vide>
            ) : (
            <div className="defilement" role="region" aria-label="Fournisseurs inscrits" tabIndex={0}>
              <table className="tableau">
                <thead>
                  <tr>
                    <th scope="col">Fournisseur</th>
                    <th scope="col">Compte inscrit</th>
                    <th scope="col">Inscription</th>
                    <th scope="col" className="droite">
                      Factures inscrites
                    </th>
                    <th scope="col" className="droite">
                      Payé
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const label = libelleOf(libelles, r.beneficiaryId, "beneficiaire");
                    return (
                      <tr key={r.beneficiaryId} data-testid="fournisseur">
                        <td data-label="Fournisseur">
                          <span className="cellule">
                            <b>
                              <Nom id={r.beneficiaryId} genre="beneficiaire" withId />
                            </b>{" "}
                            {(label?.sous_titre ?? label?.detail ?? label?.siren) && (
                              <span data-testid="fournisseur-sous">
                                {[label?.sous_titre ?? label?.detail, label?.siren ? `SIREN ${label.siren}` : null].filter((v) => v).join(" · ")}
                              </span>
                            )}
                          </span>
                        </td>
                        <td data-label="Compte inscrit">
                          <span className="cellule">
                            {label?.iban_masque ? (
                              <>
                                <span className="mono" data-testid="fournisseur-iban">
                                  {label.iban_masque}
                                </span>{" "}
                                <span>
                                  compte <OpaqueId value={r.account} missing="non lu" />
                                </span>
                              </>
                            ) : (
                              <OpaqueId value={r.account} missing="non lu" />
                            )}
                          </span>
                        </td>
                        <td data-label="Inscription">
                          bloc {r.registeredBlock} · {formatDateTime(r.registeredAtS * 1000)} <ClockTag clock="bloc" />
                        </td>
                        <td data-label="Factures inscrites" className="droite">
                          <span className="cellule">
                            <b>{r.invoices}</b> <span>{r.invoices > 0 ? <Amount wei={r.invoicedWei} /> : "—"}</span>
                          </span>
                        </td>
                        <td data-label="Payé" className="droite">
                          <span className="cellule">
                            <b>{r.paidCount}</b>{" "}
                            <span>
                              {r.paidCount > 0 ? <Amount wei={r.paidWei} /> : "—"}
                              {r.unknown > 0 && ` · ${r.unknown} montant${r.unknown > 1 ? "s" : ""} illisible${r.unknown > 1 ? "s" : ""}`}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
            </>
          );
        }}
      </Panel>
    </>
  );
}

export function AgentsView({ view, query = "", onClear = () => undefined }: { view: ViewProps } & Partial<Filtre>) {
  const { relay, response, sources, vaultOrigin, now } = view;
  const { libelles } = useAffichage();
  const linked = sameWorld(sources);
  return (
    <>
      <ReadOnlyNote>
        Agents inscrits au contrat (AgentRegistered) et leur mandat. Un agent s'inscrit, se met en pause ou reprend par le contrat, avec la clé
        du rôle habilité, hors de cette console. Une pause se lève par un humain.
      </ReadOnlyNote>
      <Panel title="Agents inscrits" id="titre-agents" source={vaultFed(sources.relay, vaultOrigin)} famille="relay" snapshot={relay} now={now} className="carte-liste">
        {(data) => {
          const all = agentRows(data.events, data.decisions, linked ? (response.data?.pausedAgents ?? null) : null, linked ? (response.data?.journal ?? null) : null);
          if (all.length === 0)
            return (
              <Vide className="carte-vide" hint="Un agent apparaît ici dès son inscription au contrat, avec son mandat.">
                Aucun agent inscrit au contrat.
              </Vide>
            );
          const kept = agentsRetenus(trouvailles(data.events, libelles), query);
          const rows = kept === null ? all : all.filter((r) => kept.has(r.agentId));
          return (
            <>
            {kept !== null && <FiltreNote query={query} shown={rows.length} total={all.length} onClear={onClear} />}
            {rows.length === 0 ? (
              <Vide className="carte-vide">Aucun agent ne correspond à « {query.trim()} ».</Vide>
            ) : (
            <div className="defilement" role="region" aria-label="Agents inscrits" tabIndex={0}>
              <table className="tableau">
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th scope="col">Mandat</th>
                    <th scope="col">Inscription</th>
                    <th scope="col" className="droite">
                      Paiements
                    </th>
                    <th scope="col" className="droite">
                      Bloqués
                    </th>
                    <th scope="col">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const label = libelleOf(libelles, r.agentId, "agent");
                    return (
                      <tr key={r.agentId} data-testid="agent">
                        <td data-label="Agent">
                          <span className="cellule">
                            <b>
                              <Nom id={r.agentId} genre="agent" withId />
                            </b>{" "}
                            {(label?.sous_titre ?? label?.detail) && <span>{label?.sous_titre ?? label?.detail}</span>}
                          </span>
                        </td>
                        <td data-label="Mandat">
                          {mandateWords(r.mandate).join(", ")}
                          {r.mandate !== null && <code className="controle-code">mandat {r.mandate}</code>}
                        </td>
                        <td data-label="Inscription">{r.registeredBlock === null ? <span className="indisponible">inscription non lue</span> : `bloc ${r.registeredBlock}`}</td>
                        <td data-label="Paiements" className="droite">
                          {r.paid}
                        </td>
                        <td data-label="Bloqués" className="droite">
                          {r.blocked}
                        </td>
                        <td data-label="Statut">
                          <AgentStatusPill status={r.status} offchainKnown={r.offchainKnown} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
            </>
          );
        }}
      </Panel>
      <Details>
        <p className="discret">
          Paiements : décisions lues comme acceptées. Bloqués : refus du contrat, et blocages à la porte d'entrée si le service de réponse est du
          même monde que le relais.
        </p>
      </Details>
    </>
  );
}

function Changed({ setting }: { setting: Setting<unknown> }) {
  if (setting === null) return <span className="regle-portee">changement non lu dans les événements</span>;
  return (
    <span className="regle-portee">
      inscrit au bloc {setting.block} · {formatDateTime(setting.atS * 1000)} <ClockTag clock="bloc" />
    </span>
  );
}

export function ReglesView({ view }: { view: ViewProps }) {
  const { relay, vault, sources, vaultOrigin, now } = view;
  return (
    <>
      <ReadOnlyNote>
        Ce que le contrat applique à chaque demande, lu dans ses vues et ses événements. Un paramètre se change par le propriétaire du contrat, avec
        sa clé, hors de cette console ; le changement s'inscrit dans les événements et se lit ici.
      </ReadOnlyNote>
      <Panel title="Validation humaine" id="titre-regles-validation" source={vaultFed(sources.vault, vaultOrigin)} famille="vault" snapshot={vault} now={now} className="carte-liste">
        {(state) => {
          const rules = rulesOf(state, relay.data?.events ?? null);
          return (
            <ul className="regles">
              <li className="regle" data-testid="regle-seuil">
                <div>
                  <b>Seuil de validation</b>{" "}
                  <p>Au-dessus, le contrat bloque le montant et renvoie la demande à un approbateur.</p>
                </div>
                <div className="regle-valeur">
                  <Amount wei={rules.thresholdWei} />{" "}
                  <Changed setting={rules.thresholdChange} />
                </div>
              </li>
              <li className="regle" data-testid="regle-delai">
                <div>
                  <b>Délai de réponse</b>
                  <p>Sans réponse humaine dans ce délai, la demande est refusée.</p>
                </div>
                <div className="regle-valeur">
                  {rules.approvalDelay === null ? <span className="indisponible">non disponible</span> : formatDelay(rules.approvalDelay.value)}{" "}
                  <Changed setting={rules.approvalDelay} />
                </div>
              </li>
            </ul>
          );
        }}
      </Panel>
      <Panel title="Trésorerie" id="titre-regles-tresorerie" source={vaultFed(sources.vault, vaultOrigin)} famille="vault" snapshot={vault} now={now} className="carte-liste">
        {(state) => {
          const rules = rulesOf(state, relay.data?.events ?? null);
          return (
            <ul className="regles">
              <li className="regle" data-testid="regle-reserve">
                <div>
                  <b>Réserve de sécurité</b>
                  <p>Montant que les agents ne peuvent jamais engager : il est retiré du plaçable.</p>
                </div>
                <div className="regle-valeur">
                  <Amount wei={rules.safetyReserveWei} />{" "}
                  <Changed setting={rules.reserveChange} />
                </div>
              </li>
              <li className="regle" data-testid="regle-pause">
                <div>
                  <b>Pause du coffre</b>
                  <p>En pause, aucune sortie n'est possible, quel que soit l'agent.</p>
                </div>
                <div className="regle-valeur">
                  {rules.vaultPaused === null ? (
                    <span className="indisponible">non disponible</span>
                  ) : rules.vaultPaused ? (
                    <Pastille ton="refus" icon="pause">
                      En pause
                    </Pastille>
                  ) : (
                    <Pastille ton="ok" icon="check">
                      Actif
                    </Pastille>
                  )}{" "}
                  <span className="regle-portee">lu au bloc {state.block_number}</span>
                </div>
              </li>
            </ul>
          );
        }}
      </Panel>
    </>
  );
}
