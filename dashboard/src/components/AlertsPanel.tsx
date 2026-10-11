// Alertes émises par le service de réponse, lues dans le journal (ALERT_SENT).
// Une alerte est affichée et journalisée ; elle n'est envoyée à personne
// (README, « Service de réponse ») : la page ne prétend pas le contraire.
import { alertKindLabel } from "../domain/labels.ts";
import { formatTime } from "../lib/format.ts";
import type { ViewProps } from "../views/shared.ts";
import { ClockTag, OpaqueId } from "./atoms.tsx";
import { Icon } from "./icons.tsx";
import { Panel } from "./Panel.tsx";

const RECIPIENTS: Record<string, string> = { ANALYST: "analyste", TREASURER: "trésorier", APPROVER: "approbateur", OPERATIONS: "exploitation" };

export function AlertsPanel({ view }: { view: ViewProps }) {
  const { response, sources, now } = view;
  return (
    <Panel title="Alertes" id="titre-alertes" source={sources.response} snapshot={response} now={now}>
      {(data) => {
        const alerts = data.journal.filter((e) => e.type === "ALERT_SENT").sort((a, b) => b.seq - a.seq);
        if (alerts.length === 0) return <p className="vide">Aucune alerte.</p>;
        return (
          <>
            <p className="discret">Lues dans le journal. Une alerte est affichée et journalisée ; aucun canal ne l'envoie à quelqu'un.</p>
            <ul className="liste-lignes">
              {alerts.map((e) => {
                const kind = typeof e.data.kind === "string" ? e.data.kind : "";
                const to = Array.isArray(e.data.recipients) ? e.data.recipients.filter((r): r is string => typeof r === "string") : [];
                const incident = typeof e.data.incident_id === "string" ? e.data.incident_id : null;
                const human = kind === "APPROVAL_REQUESTED";
                return (
                  <li key={e.seq} data-testid="alerte">
                    <p>
                      <span className={human ? "mot-attente" : "mot-veto"}>
                        <Icon name={human ? "attente" : "alerte"} /> {alertKindLabel(kind)}
                      </span>{" "}
                      <span className="discret">
                        · pour {to.length === 0 ? "—" : to.map((r) => RECIPIENTS[r] ?? "rôle inconnu").join(", ")} · {formatTime(e.ts_ms)} <ClockTag clock="journal" />
                      </span>
                    </p>
                    <p className="discret">
                      Demande <OpaqueId value={e.request_id} /> · incident <OpaqueId value={incident} missing="aucun" /> · entrée {e.seq} du journal
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        );
      }}
    </Panel>
  );
}
