// Les alertes sont envoyées par le service de réponse (specs/05), pas par
// relay/. Ici : l'interface que la file et le relais appellent, et un bouchon.
import type { Hex } from "./types.ts";

/** Faits bruts seulement : aucun texte libre, aucun contenu de demande. */
export type AvailabilityAlert = {
  kind: "QUEUE_STALL" | "SUBMISSION_IN_DOUBT";
  request_id: Hex;
  agent_id: Hex;
  /** Attente en file au moment de l'alerte, en secondes. */
  waited_s: number;
};

export interface AlertSink {
  availability(alert: AvailabilityAlert): Promise<void>;
}

export class MemoryAlerts implements AlertSink {
  readonly sent: AvailabilityAlert[] = [];
  async availability(alert: AvailabilityAlert): Promise<void> {
    this.sent.push(alert);
  }
}
