import type { IncidentReport } from "../api/types.ts";
import { computeDelays } from "../domain/delays.ts";
import { TRIGGER_LABELS } from "../domain/labels.ts";
import { formatDurationMs, formatDurationS } from "../lib/format.ts";
import { ClockTag, OpaqueId } from "./atoms.tsx";

/** Délais d'un incident. Chaque durée porte son horloge ; une durée à cheval sur deux horloges n'est pas calculée. */
export function DelaysTable({ report, chainPause }: { report: IncidentReport; chainPause: number | null }) {
  const delays = computeDelays(report, chainPause);
  return (
    <table className="delais">
      <caption>
        Incident <OpaqueId value={report.incident_id} /> · déclencheur : {TRIGGER_LABELS[report.trigger]}
      </caption>
      <thead>
        <tr>
          <th scope="col">Délai</th>
          <th scope="col">Durée</th>
          <th scope="col">Source</th>
        </tr>
      </thead>
      <tbody>
        {delays.map((d) => (
          <tr key={d.key} data-testid={`delai-${d.key}`}>
            <th scope="row">{d.label}</th>
            <td className="duree" data-label="Durée">
              {d.value === null || d.clock === null ? (
                <span className="indisponible">{d.note}</span>
              ) : d.clock === "bloc" ? (
                formatDurationS(d.value)
              ) : (
                formatDurationMs(d.value)
              )}
            </td>
            <td data-label="Source">{d.clock === null ? <span className="discret">—</span> : <ClockTag clock={d.clock} />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DelaysNote() {
  return (
    <p className="discret">
      Journal : millisecondes mesurées hors chaîne. Bloc : horodatage du bloc, précis à la seconde, attente de l'indexeur comprise. Une
      durée n'est calculée qu'entre deux instants de la même horloge.
    </p>
  );
}
