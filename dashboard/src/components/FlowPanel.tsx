import { allOutcomes, initialOutcome, requestSteps, type Outcome } from "../domain/flow.ts";
import { useArrival } from "../hooks/useArrival.ts";
import { sameWorld, vaultFed, type ViewProps } from "../views/shared.ts";
import { ClockTag, SourceTag } from "./atoms.tsx";
import { FlowDiagram, StepTimeline } from "./FlowDiagram.tsx";
import { Panel } from "./Panel.tsx";

/**
 * Le flux et la dernière issue. Décisions du contrat lues au relais, arrêts à la
 * porte lus au journal du service de réponse : chaque source garde son étiquette.
 * Une issue apparue depuis l'ouverture de la page s'illumine ; l'ordre entre les
 * deux sources est celui de leur lecture par cette page, rien de plus.
 */
export function FlowPanel({ view, large = false }: { view: ViewProps; large?: boolean }) {
  const { relay, response, sources, vaultOrigin, now } = view;
  const linked = sameWorld(sources);
  const outcomes = allOutcomes(relay.data?.decisions ?? null, response.data?.journal ?? null, response.data?.incidents ?? null, linked);
  // Décisions d'abord : à la même lecture, une décision du contrat l'emporte sur un arrêt à la porte.
  const arrival = useArrival<Outcome>([relay.data ? outcomes.contract : null, response.data ? outcomes.gateway : null]);

  return (
    <Panel title="Flux d'une demande" id="titre-flux" source={vaultFed(sources.relay, vaultOrigin)} snapshot={relay} now={now} className={`panneau-flux${large ? " panneau-flux-grand" : ""}`}>
      {() => {
        // L'issue arrivée est relue dans les données courantes : si elle a disparu, on revient à la dernière connue.
        const fresh = arrival ? [...outcomes.contract, ...outcomes.gateway].find((o) => o.key === arrival.item.key) : undefined;
        const outcome = fresh ?? initialOutcome(outcomes);
        const journal = response.data?.journal ?? null;
        // Le journal ne renseigne une décision du contrat que s'il est du même monde que le relais.
        const stepsJournal = outcome?.source === "porte" || linked ? journal : null;
        return (
          <>
            <FlowDiagram outcome={outcome} origin={vaultOrigin} pulse={fresh && arrival ? arrival.count : null} />
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
