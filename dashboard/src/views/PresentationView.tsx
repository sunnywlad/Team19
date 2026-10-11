// Présentation : la proposition de valeur, sans aucune donnée lue. La table
// ronde y joue une courte scène en boucle, étiquetée « illustration » : ce
// n'est pas une demande réelle. Seule boucle de l'interface ; mouvement réduit :
// la scène s'arrête sur son dernier plan.
import { useEffect, useState } from "react";
import { RoundTable } from "../components/RoundTable.tsx";
import { SEATS, type Seat, type Verdict } from "../domain/table.ts";

type Frame = Partial<Record<Seat["key"], [Verdict, string]>>;

/** Une facture piégée passe la porte, le contrat met son veto. Exemple écrit à la main. */
const PASSED: Frame = {
  porte: ["passe", "exemple : détecteur et schéma passés"],
  ia: ["passe", "exemple : signée par la clé du client"],
  relais: ["passe", "exemple : soumise au contrat"],
};
const FRAMES: Frame[] = [
  { porte: ["attente", "exemple : reçue, tests en cours"] },
  { porte: PASSED.porte, ia: ["attente", "exemple : signature en cours"] },
  { porte: PASSED.porte, ia: PASSED.ia, relais: ["attente", "exemple : en file"] },
  { ...PASSED, contrat: ["attente", "exemple : le contrat lit son propre état"] },
  { ...PASSED, contrat: ["veto", "exemple : facture inconnue du contrat"] },
];
const STEP_MS = 1400;
const LAST = FRAMES.length - 1;

function seatsOf(frame: Frame): Seat[] {
  let stopped = false;
  return SEATS.map(({ key, label }) => {
    const set = frame[key];
    const seat: Seat = set
      ? { key, label, verdict: set[0], reason: set[1] }
      : { key, label, verdict: "non-atteint", reason: stopped ? "exemple : arrêtée avant" : "exemple : pas encore atteint" };
    if (set?.[0] === "veto") stopped = true;
    return seat;
  });
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function PresentationView() {
  const [still] = useState(reducedMotion);
  const [index, setIndex] = useState(still ? LAST : 0);
  useEffect(() => {
    if (still) return;
    // Le dernier plan, le veto, reste deux temps à l'écran avant que la scène reprenne.
    const timer = setInterval(() => setIndex((i) => (i >= LAST + 1 ? 0 : i + 1)), STEP_MS);
    return () => clearInterval(timer);
  }, [still]);
  const frame = FRAMES[Math.min(index, LAST)] ?? {};
  return (
    <section className="presentation" aria-labelledby="titre-presentation">
      <div className="presentation-texte">
        <p className="presentation-sur">Veto · Argent Intelligent</p>
        <h2 id="titre-presentation">Une seule couche suffit à mettre son veto.</h2>
        <p>Des agents IA demandent des paiements ; aucun ne tient la clé du coffre.</p>
        <p>Porte d'entrée, IA du client, relais, contrat et humain statuent chacun à leur tour, et chacun peut tout arrêter.</p>
        <p>Chaque verdict est journalisé dans un journal chaîné, vérifiable par un script.</p>
      </div>
      <div className="presentation-table">
        <RoundTable seats={seatsOf(frame)} requestId={null} illustration detail={<p className="table-detail">scène d'exemple, aucune donnée lue</p>} />
      </div>
    </section>
  );
}
