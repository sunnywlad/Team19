import { useState } from "react";
import { PAGE_LIMIT } from "../api/client.ts";
import { Nom } from "../components/Affichage.tsx";
import { Amount, ClockTag, Details, SourceTag, Vide } from "../components/atoms.tsx";
import { DecisionsChart } from "../components/DecisionsChart.tsx";
import { DecisionsTable } from "../components/DecisionsTable.tsx";
import { Icon } from "../components/icons.tsx";
import { OffContractList } from "../components/OffContractList.tsx";
import { Panel } from "../components/Panel.tsx";
import { PlaceableValues } from "../components/PlaceablePanel.tsx";
import { Counter } from "../components/Rolling.tsx";
import { AgentStatusPill, SeverityPill } from "../components/pills.tsx";
import { latestIncidents, offContractLines } from "../domain/activity.ts";
import { blockedRequests, blockedSummary, decisionsByDay, interventionShare, paidSummary, pendingSummary, type Sum } from "../domain/apercu.ts";
import { TRIGGER_LABELS } from "../domain/labels.ts";
import { readDecision } from "../domain/reasons.ts";
import { agentRows, mandateWords } from "../domain/referentiels.ts";
import { openCases } from "../domain/validation.ts";
import { formatTime } from "../lib/format.ts";
import { makeReactionFor, sameWorld, vaultFed, type ViewProps } from "./shared.ts";

const PERCENT = new Intl.NumberFormat("fr-FR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Somme connue, et ce qui n'a pas pu y entrer. Tout inconnu : « montant inconnu », jamais 0. */
function SumLine({ sum, suffix }: { sum: Sum; suffix: string }) {
  if (sum.count > 0 && sum.unknown === sum.count) return <span className="indisponible">montant inconnu</span>;
  return (
    <>
      <Amount wei={sum.knownWei} /> {suffix}
      {sum.unknown > 0 && <span className="discret"> · {plural(sum.unknown, "montant inconnu", "montants inconnus")}, hors total</span>}
    </>
  );
}

type Opens = (screen: "valider" | "incidents") => void;

/**
 * Vue d'ensemble : la supervision et les décisions réunies. Aucune donnée
 * propre : chaque nombre est lu dans les mêmes réponses que les autres écrans
 * (src/domain/apercu.ts), et chaque carte porte la provenance de sa source.
 */
export function ApercuView({ view, onOpen }: { view: ViewProps; onOpen: Opens }) {
  const { relay, vault, response, sources, vaultOrigin, now } = view;
  const relayTag = vaultFed(sources.relay, vaultOrigin);
  const linked = sameWorld(sources);
  const journal = linked ? (response.data?.journal ?? null) : null;
  const [days, setDays] = useState<7 | 30>(7);
  const reactionFor = makeReactionFor(sources, response.data);
  const fake = relayTag === "faux-coffre";

  return (
    <>
      <div className="kpis">
        <Panel title="Paiements exécutés" id="titre-kpi-payes" source={relayTag} famille="relay" snapshot={relay} now={now} className="carte-kpi">
          {(data) => {
            const paid = paidSummary(data.events);
            return (
              <>
                <p className="kpi-valeur" data-testid="kpi-payes">
                  {paid.count > 0 && paid.unknown === paid.count ? <span className="indisponible">montant inconnu</span> : <Amount wei={paid.knownWei} />}
                </p>
                <p className="kpi-sous">
                  {paid.count === 0 ? "Aucun paiement exécuté pour l'instant." : plural(paid.count, "paiement", "paiements")}
                  {paid.unknown > 0 && ` · ${plural(paid.unknown, "montant illisible", "montants illisibles")}, hors total`}
                </p>
              </>
            );
          }}
        </Panel>
        <Panel title="Sans intervention" id="titre-kpi-auto" source={relayTag} famille="relay" snapshot={relay} now={now} className="carte-kpi">
          {(data) => {
            const share = interventionShare(data.decisions);
            return (
              <>
                <p className="kpi-valeur" data-testid="kpi-auto">
                  {share.share === null ? <span className="indisponible">non disponible</span> : PERCENT.format(share.share)}
                </p>
                <p className="kpi-sous">
                  {share.share === null
                    ? "Aucun paiement lu : la part s'affichera au premier."
                    : `${share.auto} sur ${share.auto + share.approved} payés sans validation humaine`}
                </p>
              </>
            );
          }}
        </Panel>
        <Panel title="À valider" id="titre-kpi-valider" source={relayTag} famille="relay" snapshot={relay} now={now} className="carte-kpi">
          {(data) => {
            const pending = pendingSummary(openCases(data.decisions, data.events));
            return (
              <>
                <p className="kpi-valeur" data-testid="kpi-valider">
                  <Counter value={pending.count} />
                </p>
                <p className="kpi-sous">
                  {pending.count === 0 ? "Rien n'attend votre décision." : <SumLine sum={pending} suffix="en attente de décision" />}
                </p>
                <button type="button" className="lien kpi-lien" data-ui="navigation" onClick={() => onOpen("valider")}>
                  Ouvrir « À valider » <Icon name="chevron" />
                </button>
              </>
            );
          }}
        </Panel>
        <Panel title="Bloqués par une règle" id="titre-kpi-bloques" source={relayTag} famille="relay" snapshot={relay} now={now} className="carte-kpi">
          {(data) => {
            const blocked = blockedRequests(data.decisions, data.events, linked ? (response.data?.journal ?? null) : null, linked);
            const sum = blockedSummary(blocked);
            const gate = blocked.filter((b) => b.origin === "porte").length;
            return (
              <>
                <p className="kpi-valeur" data-testid="kpi-bloques">
                  <Counter value={sum.count} />
                </p>
                <p className="kpi-sous">
                  {sum.count === 0 ? "Aucune demande bloquée." : <SumLine sum={sum} suffix="non sortis" />}
                </p>
                {sum.count > 0 && (
                <p className="kpi-sous">
                  {linked && response.data
                    ? `dont ${gate} à la porte d'entrée`
                    : "porte d'entrée non comptée : service de réponse non lu ou d'un autre monde"}
                </p>
                )}
              </>
            );
          }}
        </Panel>
      </div>

      <div className="deux deux-large">
        <Panel title="Décisions par jour" id="titre-jours" source={relayTag} famille="relay" snapshot={relay} now={now}>
          {(data) => (
            <>
              <div className="carte-outils">
                <div className="segment" role="group" aria-label="Période">
                  {([7, 30] as const).map((n) => (
                    <button key={n} type="button" data-ui="affichage" aria-pressed={days === n} onClick={() => setDays(n)}>
                      {n} jours
                    </button>
                  ))}
                </div>
              </div>
              <DecisionsChart days={decisionsByDay(data.decisions, blockedRequests(data.decisions, data.events, journal, linked), now, days)} />
              <Details>
                <p className="discret">
                  Jour local du navigateur · bloc pour le contrat, journal pour la porte <ClockTag clock="locale" />
                </p>
              </Details>
            </>
          )}
        </Panel>
        <Panel title="Montant plaçable" id="titre-placable" source={vaultFed(sources.vault, vaultOrigin)} famille="vault" snapshot={vault} now={now}>
          {(state) => <PlaceableValues vault={state} simulated={vaultFed(sources.vault, vaultOrigin) === "faux-coffre"} />}
        </Panel>
      </div>

      <div className="deux">
        <Panel title="En attente de votre décision" id="titre-sup-attente" source={relayTag} famille="relay" snapshot={relay} now={now}>
          {(data) => {
            const cases = openCases(data.decisions, data.events).slice(0, 4);
            return (
              <>
                {cases.length === 0 ? (
                  <Vide hint="L'approbateur est notifié à chaque nouvelle demande au-dessus du seuil.">Aucune demande n'attend votre décision.</Vide>
                ) : (
                  <ul className="liste-lignes">
                    {cases.map((c) => (
                      <li key={c.requestId} data-testid="sup-cas">
                        <span className="cellule">
                          <b>
                            <Nom id={c.beneficiaryId} genre="beneficiaire" missing="bénéficiaire non lu" />
                          </b>{" "}
                          <span>
                            <Nom id={c.refId} /> · au-dessus du seuil
                          </span>
                        </span>
                        <span className="cellule droite">
                          <b>
                            <Amount wei={c.amountWei} />
                          </b>{" "}
                          <span>{c.deadline === null ? "échéance non lue" : `avant ${formatTime(c.deadline * 1000)}`}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="carte-pied">
                  <button type="button" className="lien" data-ui="navigation" onClick={() => onOpen("valider")}>
                    Tout voir
                  </button>
                </p>
              </>
            );
          }}
        </Panel>
        <Panel title="Derniers incidents" id="titre-sup-incidents" source={sources.response} famille="response" snapshot={response} now={now}>
          {(data) => {
            const incidents = latestIncidents(data.incidents).slice(0, 4);
            return (
              <>
                {incidents.length === 0 ? (
                  <Vide hint="Toute demande arrêtée par la porte d'entrée ou par le contrat apparaîtra ici, avec son rapport.">Aucun incident.</Vide>
                ) : (
                  <ul className="liste-lignes">
                    {incidents.map(({ report }) => (
                      <li key={report.incident_id} data-testid="sup-incident">
                        <span className="cellule">
                          <b>{TRIGGER_LABELS[report.trigger]}</b>{" "}
                          <span>
                            <Nom id={report.authority_chain.agent_id} genre="agent" /> · {formatTime(report.generated_at_ms)}
                          </span>
                        </span>
                        <SeverityPill trigger={report.trigger} />
                      </li>
                    ))}
                  </ul>
                )}
                <p className="carte-pied">
                  <button type="button" className="lien" data-ui="navigation" onClick={() => onOpen("incidents")}>
                    Tout voir
                  </button>
                </p>
              </>
            );
          }}
        </Panel>
      </div>

      <Panel title="Agents" id="titre-sup-agents" source={relayTag} famille="relay" snapshot={relay} now={now}>
        {(data) => {
          const rows = agentRows(data.events, data.decisions, linked ? (response.data?.pausedAgents ?? null) : null, journal);
          if (rows.length === 0) return <Vide hint="Un agent apparaît ici dès son inscription au contrat.">Aucun agent inscrit au contrat.</Vide>;
          return (
            <div className="defilement" role="region" aria-label="Agents" tabIndex={0}>
              <table className="tableau">
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th scope="col">Mandat</th>
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
                  {rows.map((r) => (
                    <tr key={r.agentId} data-testid="sup-agent">
                      <td data-label="Agent">
                        <Nom id={r.agentId} genre="agent" withId />
                      </td>
                      <td data-label="Mandat">{mandateWords(r.mandate).join(", ")}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Panel>

      <Panel title="Décisions du contrat" id="titre-decisions" source={relayTag} famille="relay" snapshot={relay} now={now}>
        {(data) => {
          const refused = data.decisions.filter((d) => readDecision(d).kind === "refuse").length;
          return (
            <>
              {(data.decisions.length >= PAGE_LIMIT || data.events.length >= PAGE_LIMIT) && (
                <p className="alerte-ligne" role="status">
                  Affichage tronqué : l'API ne renvoie que les {PAGE_LIMIT} premiers événements (voir API-NEEDS.md § 6).
                </p>
              )}
              <DecisionsTable decisions={data.decisions} events={data.events} reactionFor={reactionFor} />
              <Details>
                {fake && (
                  <p className="alerte-ligne" data-testid="decisions-simulees">
                    Décisions d'un faux coffre : aucun contrat n'a jugé, aucun fonds n'a bougé.
                  </p>
                )}
                <p className="discret">
                  Lues dans les événements <code>Decision</code> indexés, jamais dans le statut d'un reçu de transaction. {data.decisions.length}{" "}
                  événement{data.decisions.length > 1 ? "s" : ""}, dont {refused} refus.
                </p>
              </Details>
            </>
          );
        }}
      </Panel>

      <div className="deux">
        <Panel title="Arrêtées à la porte d'entrée" id="titre-porte" source={sources.response} famille="response" snapshot={response} now={now}>
          {(data) => <OffContractList lines={offContractLines(data.journal, [], [])} sources={sources} reactionFor={reactionFor} />}
        </Panel>
        <Panel title="File du relais" id="titre-file" source={sources.relay} famille="relay" snapshot={relay} now={now}>
          {(data) => <OffContractList lines={offContractLines([], data.queue, data.decisions)} sources={sources} reactionFor={reactionFor} />}
        </Panel>
      </div>
      <Details testId="apercu-details">
        <p className="discret">
          Chaque carte porte sa source en icône, détaillée dans le panneau « Sources » de la barre haute : <SourceTag source="reel" /> lu en direct,{" "}
          <SourceTag source="simulation" /> point d'accès simulé, <SourceTag source="non-confirme" /> le proxy n'a pas dit ce qui est derrière le
          relais. Paiements exécutés : événements Paid.
        </p>
      </Details>
    </>
  );
}
