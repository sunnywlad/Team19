// Incidents ouverts, en bref : le détail et le rapport sont sur la page
// « Alertes et rapports ». Un incident est ouvert tant qu'aucun humain ne l'a
// qualifié (human_decision null).
import { latestIncidents } from "../domain/activity.ts";
import { ACTION_TAKEN_LABELS, TRIGGER_LABELS } from "../domain/labels.ts";
import { formatTime } from "../lib/format.ts";
import type { ViewProps } from "../views/shared.ts";
import { ClockTag, OpaqueId } from "./atoms.tsx";
import { Icon } from "./icons.tsx";
import { Panel } from "./Panel.tsx";
import { Counter } from "./Rolling.tsx";

export function OpenIncidents({ view, onOpen }: { view: ViewProps; onOpen: (incidentId: string) => void }) {
  const { response, sources, now } = view;
  return (
    <Panel title="Incidents ouverts" id="titre-incidents-ouverts" source={sources.response} snapshot={response} now={now} className="panneau-incidents">
      {(data) => {
        const all = latestIncidents(data.incidents);
        const open = all.filter((i) => i.report.human_decision === null);
        return (
          <>
            <p className="compte-ligne">
              <span className="nombre grand" data-testid="accueil-incidents-ouverts">
                <Counter value={open.length} />
              </span>{" "}
              ouvert{open.length > 1 ? "s" : ""} <span className="discret">· {all.length - open.length} qualifié{all.length - open.length > 1 ? "s" : ""} par un humain</span>
            </p>
            {open.length === 0 ? (
              <p className="vide">Aucun incident ouvert.</p>
            ) : (
              <ul className="liste-lignes">
                {open.slice(0, 5).map(({ report }) => (
                  <li key={report.incident_id} data-testid="accueil-incident">
                    <p>
                      <span className="mot-veto">
                        <Icon name="veto" /> {TRIGGER_LABELS[report.trigger]}
                      </span>{" "}
                      <span className="discret">
                        · agent <OpaqueId value={report.authority_chain.agent_id} /> · {formatTime(report.generated_at_ms)} <ClockTag clock="journal" />
                      </span>
                    </p>
                    <p className="discret">
                      {report.automatic_actions.length === 0 ? "aucune action automatique" : report.automatic_actions.map((a) => ACTION_TAKEN_LABELS[a.action]).join(" · ")}
                    </p>
                    <button type="button" className="bouton-lien" data-ui="navigation" onClick={() => onOpen(report.incident_id)}>
                      Rapport <OpaqueId value={report.incident_id} />
                    </button>
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
