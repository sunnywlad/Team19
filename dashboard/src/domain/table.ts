// La table ronde : cinq sièges, les cinq couches que traverse une demande, dans
// l'ordre du flux. L'état de chaque siège se lit dans une issue déjà établie
// (domain/flow.ts) : rien n'est déduit au-delà. Un siège qui n'a pas statué reste
// « au repos » ou « non atteint », jamais coché par supposition.
import type { Outcome } from "./flow.ts";

export const SEATS = ["porte", "ia", "relais", "contrat", "humain"] as const;
export type SeatKey = (typeof SEATS)[number];

export type SeatState = "repos" | "passe" | "veto" | "attente" | "non-atteint";

export const SEAT_LABELS: Record<SeatKey, string> = {
  porte: "Porte d'entrée",
  ia: "IA du client",
  relais: "Relais",
  contrat: "Contrat",
  humain: "Humain",
};

/** L'état en mots : un siège ne se lit jamais par sa couleur seule. */
export const SEAT_STATE_WORDS: Record<SeatState, string> = {
  repos: "Au repos",
  passe: "Passé",
  veto: "Veto",
  attente: "En attente",
  "non-atteint": "Non atteint",
};

export type Seat = {
  key: SeatKey;
  state: SeatState;
  /** Code du motif, sur le siège qui a statué en dernier. Jamais un texte libre. */
  code: string | null;
};

const all = (state: SeatState): Record<SeatKey, SeatState> => ({ porte: state, ia: state, relais: state, contrat: state, humain: state });

/**
 * Les cinq sièges pour une issue. Sans issue : tous au repos.
 * - Arrêt à la porte : la porte pose son veto, les quatre autres ne sont pas atteints.
 * - Décision du contrat : porte, IA du client et relais ont laissé passer. Le
 *   contrat a payé, renvoyé à un humain, ou posé son veto.
 * - Humain : en attente (cas 1 ouvert), passé (approbation), veto (refus ou délai
 *   dépassé), non atteint (veto du contrat avant lui), au repos (paiement direct :
 *   personne ne lui a rien demandé).
 */
export function seatsFor(outcome: Outcome | null): Seat[] {
  let states = all("repos");
  let decider: SeatKey | null = null;
  if (outcome !== null && outcome.source === "porte") {
    states = { ...all("non-atteint"), porte: "veto" };
    decider = "porte";
  } else if (outcome !== null) {
    const viaHuman = outcome.nodes.includes("humain");
    states = { porte: "passe", ia: "passe", relais: "passe", contrat: "passe", humain: "repos" };
    decider = "contrat";
    if (outcome.tone === "humain") {
      states.humain = "attente";
    } else if (outcome.tone === "accepte") {
      if (viaHuman) {
        states.humain = "passe";
        decider = "humain";
      }
    } else if (viaHuman) {
      states.humain = "veto";
      decider = "humain";
    } else {
      states.contrat = "veto";
      states.humain = "non-atteint";
    }
  }
  return SEATS.map((key) => ({ key, state: states[key], code: key === decider ? (outcome?.code ?? null) : null }));
}

/** Description d'une table pour un lecteur d'écran : chaque siège et son état, en mots. */
export function describeSeats(seats: Seat[]): string {
  return `Table ronde : ${seats.map((s) => `${SEAT_LABELS[s.key]} ${SEAT_STATE_WORDS[s.state].toLowerCase()}`).join(", ")}`;
}
