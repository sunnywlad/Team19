// Les trois délais de specs/05 § 5, avec une règle de plus : une durée n'est
// calculée qu'entre deux horodatages de la MÊME horloge.
//   journal : millisecondes mesurées hors chaîne (porte d'entrée, service de réponse)
//   bloc    : horodatage du bloc, en secondes
// Pour une détection par le contrat, « detected_at_ms » est l'horodatage du bloc
// (specs/05 § 5) : le soustraire à une heure du journal mélangerait deux
// horloges. Ces lignes sont affichées « non calculé », et les durées mesurables
// sur une seule horloge sont données à côté.
import type { IncidentReport, RelayEvent } from "../api/types.ts";

export type Clock = "journal" | "bloc";

export type Delay = {
  key: string;
  label: string;
  /** Horloge commune aux deux bornes ; null si la durée n'est pas calculée. */
  clock: Clock | null;
  /** En millisecondes (journal) ou en secondes (bloc). */
  value: number | null;
  /** Pourquoi la durée manque. */
  note: string | null;
};

/** Détection par le contrat : l'heure de détection est celle du bloc. */
export function detectionClock(report: IncidentReport): Clock {
  return report.trigger === "CONTRACT_REFUSAL" || report.trigger === "REPEATED_REFUSALS" ? "bloc" : "journal";
}

function between(key: string, label: string, from: number | null, fromClock: Clock, to: number | null, toClock: Clock): Delay {
  if (from === null || to === null) return { key, label, clock: null, value: null, note: "non disponible" };
  if (fromClock !== toClock) {
    return { key, label, clock: null, value: null, note: `non calculé : horloges différentes (${fromClock} → ${toClock})` };
  }
  if (to < from) return { key, label, clock: null, value: null, note: "incohérent : la fin précède le début" };
  return { key, label, clock: fromClock, value: to - from, note: null };
}

/**
 * Délais d'un incident. « chainPauseTimestamp » est l'horodatage du bloc de
 * l'événement AgentPaused de cet agent, lu dans l'indexeur, s'il existe.
 */
export function computeDelays(report: IncidentReport, chainPauseTimestamp: number | null = null): Delay[] {
  const t = report.timestamps;
  const detected = detectionClock(report);
  const delays: Delay[] = [
    between("arrivee-detection", "Arrivée → détection", t.received_at_ms, "journal", t.detected_at_ms, detected),
    between("detection-pause", "Détection → pause", t.detected_at_ms, detected, t.paused_at_ms, "journal"),
    between("detection-alerte", "Détection → alerte", t.detected_at_ms, detected, t.alerted_at_ms, "journal"),
  ];
  if (detected === "bloc") {
    // Durées de la même attaque, chacune sur une seule horloge.
    delays.push(
      between("arrivee-observation", "Arrivée → lecture de la décision par la réponse", t.received_at_ms, "journal", t.observed_at_ms, "journal"),
      between("observation-pause", "Lecture de la décision → pause", t.observed_at_ms, "journal", t.paused_at_ms, "journal"),
      between("observation-alerte", "Lecture de la décision → alerte", t.observed_at_ms, "journal", t.alerted_at_ms, "journal"),
    );
    if (report.contract && chainPauseTimestamp !== null) {
      delays.push(between("decision-pause-chaine", "Décision → pause sur la chaîne", report.contract.block_timestamp, "bloc", chainPauseTimestamp, "bloc"));
    }
  }
  return delays;
}

/** Horodatage du bloc de la première pause sur la chaîne de cet agent, à partir du bloc donné. */
export function chainPauseTimestamp(events: RelayEvent[], agentId: string, fromBlock: number): number | null {
  const found = events
    .filter((e) => e.name === "AgentPaused" && e.args.agentId === agentId && e.block_number >= fromBlock)
    .sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index)[0];
  return found ? found.block_timestamp : null;
}
