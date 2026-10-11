import { Panel } from "../components/Panel.tsx";
import { PlaceableValues } from "../components/PlaceablePanel.tsx";
import { latestIncidents, offContractLines, pendingCases } from "../domain/activity.ts";
import { readDecision } from "../domain/reasons.ts";
import { vaultFed, type ViewProps } from "./shared.ts";

/**
 * Vue d'ensemble : ce que les autres écrans détaillent, compté. Aucune donnée
 * propre : chaque nombre est lu dans les mêmes réponses que les autres écrans,
 * et chaque carte porte la provenance de sa source.
 */
export function SupervisionView({ view }: { view: ViewProps }) {
  const { relay, vault, response, sources, vaultOrigin, now } = view;
  const relayTag = vaultFed(sources.relay, vaultOrigin);
  return (
    <>
      <div className="grille-haut">
        <Panel title="Contrat" id="titre-sup-contrat" source={relayTag} snapshot={relay} now={now}>
          {(data) => {
            const kinds = data.decisions.map((d) => readDecision(d).kind);
            const count = (kind: string): number => kinds.filter((k) => k === kind).length;
            return (
              <dl className="compteurs">
                <div>
                  <dt>Acceptées et payées</dt>
                  <dd data-testid="sup-acceptees">{count("accepte")}</dd>
                </div>
                <div>
                  <dt>En validation humaine</dt>
                  <dd data-testid="sup-attente">{pendingCases(data.decisions, data.events).length}</dd>
                </div>
                <div>
                  <dt>Refusées par le contrat</dt>
                  <dd data-testid="sup-refusees">{count("refuse")}</dd>
                </div>
              </dl>
            );
          }}
        </Panel>
        <Panel title="Porte d'entrée et réponse" id="titre-sup-reponse" source={sources.response} snapshot={response} now={now}>
          {(data) => (
            <dl className="compteurs">
              <div>
                <dt>Arrêtées à la porte d'entrée</dt>
                <dd data-testid="sup-porte">{offContractLines(data.journal, [], []).length}</dd>
              </div>
              <div>
                <dt>Incidents ouverts</dt>
                <dd data-testid="sup-incidents">{latestIncidents(data.incidents).filter((i) => i.report.human_decision === null).length}</dd>
              </div>
              <div>
                <dt>Agents en pause, hors chaîne</dt>
                <dd data-testid="sup-pauses">{data.pausedAgents.filter((p) => p.scope === "OFFCHAIN").length}</dd>
              </div>
            </dl>
          )}
        </Panel>
      </div>

      <Panel title="Montant plaçable" id="titre-sup-placable" source={vaultFed(sources.vault, vaultOrigin)} snapshot={vault} now={now}>
        {(state) => <PlaceableValues vault={state} simulated={vaultFed(sources.vault, vaultOrigin) === "faux-coffre"} />}
      </Panel>
    </>
  );
}
