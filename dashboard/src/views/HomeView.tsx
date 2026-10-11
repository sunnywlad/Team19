// Accueil : le cockpit. L'ordre de la page est l'ordre de lecture, et le poids
// visuel le suit : bandeau d'état, action humaine requise, table ronde de la
// demande sélectionnée, incidents ouverts, journal. Le registre détaillé vient
// ensuite, en retrait.
import type { ReactNode } from "react";
import { PAGE_LIMIT } from "../api/client.ts";
import { DecisionsTable } from "../components/DecisionsTable.tsx";
import { DelaysNote, DelaysTable } from "../components/DelaysPanel.tsx";
import { HumanAction } from "../components/HumanAction.tsx";
import { OffContractList } from "../components/OffContractList.tsx";
import { OpenIncidents } from "../components/OpenIncidents.tsx";
import { Panel } from "../components/Panel.tsx";
import { PlaceableValues } from "../components/PlaceablePanel.tsx";
import { StatusStrip } from "../components/StatusStrip.tsx";
import { latestIncidents, offContractLines } from "../domain/activity.ts";
import { chainPauseTimestamp } from "../domain/delays.ts";
import { readDecision } from "../domain/reasons.ts";
import { JournalEntries, JournalIntegrity } from "./JournalView.tsx";
import { makeReactionFor, sameWorld, vaultFed, type ViewProps } from "./shared.ts";

/** Registre détaillé : décisions, arrêts avant le contrat, plaçable, délais. */
function Register({ view }: { view: ViewProps }) {
  const { relay, vault, response, sources, vaultOrigin, now } = view;
  const fake = vaultFed(sources.relay, vaultOrigin) === "faux-coffre";
  const reactionFor = makeReactionFor(sources, response.data);
  const linked = sameWorld(sources);
  return (
    <section className="registre" aria-labelledby="titre-registre">
      <h2 id="titre-registre" className="registre-titre">
        Registre
      </h2>
      <Panel title="Décisions du contrat" id="titre-decisions" source={vaultFed(sources.relay, vaultOrigin)} snapshot={relay} now={now}>
        {(data) => {
          const refused = data.decisions.filter((d) => readDecision(d).kind === "refuse").length;
          return (
            <>
              {fake && (
                <p className="alerte-ligne" data-testid="decisions-simulees">
                  Décisions d'un faux coffre : aucun contrat n'a jugé, aucun fonds n'a bougé.
                </p>
              )}
              <p className="discret">
                Lues dans les événements <code>Decision</code> indexés, jamais dans le statut d'un reçu de transaction. {data.decisions.length}{" "}
                événement{data.decisions.length > 1 ? "s" : ""}, dont {refused} refus.
              </p>
              {(data.decisions.length >= PAGE_LIMIT || data.events.length >= PAGE_LIMIT) && (
                <p className="alerte-ligne" role="status">
                  Affichage tronqué : l'API ne renvoie que les {PAGE_LIMIT} premiers événements (voir API-NEEDS.md § 6).
                </p>
              )}
              <DecisionsTable decisions={data.decisions} events={data.events} reactionFor={reactionFor} />
            </>
          );
        }}
      </Panel>

      <div className="grille-deux">
        <Panel title="Arrêtées à la porte d'entrée" id="titre-porte" source={sources.response} snapshot={response} now={now}>
          {(data) => <OffContractList lines={offContractLines(data.journal, [], [])} sources={sources} reactionFor={reactionFor} />}
        </Panel>
        <Panel title="File du relais" id="titre-file" source={sources.relay} snapshot={relay} now={now}>
          {(data) => <OffContractList lines={offContractLines([], data.queue, data.decisions)} sources={sources} reactionFor={reactionFor} />}
        </Panel>
      </div>

      <div className="grille-deux">
        <Panel title="Montant plaçable" id="titre-placable" source={vaultFed(sources.vault, vaultOrigin)} snapshot={vault} now={now} className="panneau-placable">
          {(state) => <PlaceableValues vault={state} simulated={vaultFed(sources.vault, vaultOrigin) === "faux-coffre"} />}
        </Panel>
        <Panel title="Délais mesurés" id="titre-delais" source={sources.response} snapshot={response} now={now}>
          {(data) => {
            const latest = latestIncidents(data.incidents)[0];
            if (!latest) return <p className="vide">Aucun incident : aucun délai à mesurer.</p>;
            const { report } = latest;
            const pause =
              linked && relay.data && report.contract
                ? chainPauseTimestamp(relay.data.events, report.authority_chain.agent_id, report.contract.block_number)
                : null;
            return (
              <>
                <DelaysTable report={report} chainPause={pause} />
                <DelaysNote />
              </>
            );
          }}
        </Panel>
      </div>
    </section>
  );
}

type Props = {
  view: ViewProps;
  onOpenValidation: () => void;
  onOpenIncident: (incidentId: string) => void;
  /** Table ronde de la demande sélectionnée (étape suivante). */
  table?: ReactNode;
  onShow?: (requestId: string) => void;
};

export function HomeView({ view, onOpenValidation, onOpenIncident, table, onShow }: Props) {
  return (
    <div className="accueil">
      <StatusStrip view={view} />
      <HumanAction view={view} onOpenValidation={onOpenValidation} {...(onShow ? { onShow } : {})} />
      {table}
      <div className="grille-incidents">
        <OpenIncidents view={view} onOpen={onOpenIncident} />
        <JournalIntegrity view={view} />
      </div>
      <JournalEntries view={view} />
      <Register view={view} />
    </div>
  );
}
