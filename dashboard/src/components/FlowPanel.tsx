import { allOutcomes, initialOutcome, requestSteps } from "../domain/flow.ts";
import { sameWorld, vaultFed, type ViewProps } from "../views/shared.ts";
import { ClockTag, SourceTag } from "./atoms.tsx";
import { FlowDiagram, StepTimeline } from "./FlowDiagram.tsx";
import { Panel } from "./Panel.tsx";

/**
 * Le flux et la dernière issue. Décisions du contrat lues au relais, arrêts à la
 * porte lus au journal du service de réponse : chaque source garde son étiquette.
 */
export function FlowPanel({ view }: { view: ViewProps }) {
  const { relay, response, sources, vaultOrigin, now } = view;
  const linked = sameWorld(sources);
  return (
    <Panel title="Flux d'une demande" id="titre-flux" source={vaultFed(sources.relay, vaultOrigin)} snapshot={relay} now={now} className="panneau-flux">
      {(data) => {
        const journal = response.data?.journal ?? null;
        const outcomes = allOutcomes(data.decisions, journal, response.data?.incidents ?? null, linked);
        const outcome = initialOutcome(outcomes);
        // Le journal ne renseigne une décision du contrat que s'il est du même monde que le relais.
        const stepsJournal = outcome?.source === "porte" || linked ? journal : null;
        return (
          <>
            <FlowDiagram outcome={outcome} origin={vaultOrigin} />
            {outcome !== null && (
              <>
                <StepTimeline steps={requestSteps(outcome, stepsJournal)} />
                <p className="discret flux-note">
                  Étapes cochées seulement si le journal les atteste <ClockTag clock="journal" />. Arrêts à la porte et réponse lus au service de
                  réponse <SourceTag source={sources.response} />
                  {!linked && " : non rapprochés des décisions du relais, mondes différents"}.
                </p>
              </>
            )}
          </>
        );
      }}
    </Panel>
  );
}
