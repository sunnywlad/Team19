import { PAGE_LIMIT } from "../api/client.ts";
import { DecisionsTable } from "../components/DecisionsTable.tsx";
import { DelaysNote, DelaysTable } from "../components/DelaysPanel.tsx";
import { OffContractList } from "../components/OffContractList.tsx";
import { Panel } from "../components/Panel.tsx";
import { PlaceableValues } from "../components/PlaceablePanel.tsx";
import { latestIncidents, offContractLines } from "../domain/activity.ts";
import { chainPauseTimestamp } from "../domain/delays.ts";
import { readDecision } from "../domain/reasons.ts";
import { makeReactionFor, sameWorld, type ViewProps } from "./shared.ts";

export function DecisionsView({ view }: { view: ViewProps }) {
  const { relay, vault, response, sources, now } = view;
  const reactionFor = makeReactionFor(sources, response.data);
  const linked = sameWorld(sources);
  return (
    <>
      <div className="grille-haut">
        <Panel title="Montant plaçable" id="titre-placable" source={sources.vault} snapshot={vault} now={now} className="panneau-placable">
          {(state) => <PlaceableValues vault={state} />}
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

      <Panel title="Décisions du contrat" id="titre-decisions" source={sources.relay} snapshot={relay} now={now}>
        {(data) => {
          const refused = data.decisions.filter((d) => readDecision(d).kind === "refuse").length;
          return (
            <>
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

      <div className="grille-bas">
        <Panel title="Arrêtées à la porte d'entrée" id="titre-porte" source={sources.response} snapshot={response} now={now}>
          {(data) => (
            <OffContractList lines={offContractLines(data.journal, [], [])} sources={sources} reactionFor={reactionFor} />
          )}
        </Panel>
        <Panel title="File du relais" id="titre-file" source={sources.relay} snapshot={relay} now={now}>
          {(data) => <OffContractList lines={offContractLines([], data.queue, data.decisions)} sources={sources} reactionFor={reactionFor} />}
        </Panel>
      </div>
    </>
  );
}
