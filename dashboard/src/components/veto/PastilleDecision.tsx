import type { Tone } from "../../domain/flow.ts";
import { GLYPHS, type GlyphName } from "./glyphs.tsx";

// Trois signes pour une décision du contrat : le chiffre, le glyphe, le mot.
// « Arrêté à la porte » n'est pas une décision du contrat : pas de chiffre.
const SIGNS: Record<Tone, { digit: 0 | 1 | 2 | null; glyph: GlyphName; word: string }> = {
  refuse: { digit: 0, glyph: "croix", word: "Refusé" },
  humain: { digit: 1, glyph: "sablier", word: "Validation humaine" },
  accepte: { digit: 2, glyph: "coche", word: "Payé" },
  bloque: { digit: null, glyph: "barre", word: "Arrêté à la porte" },
};

/**
 * Pastille de décision. « Payé » se dit d'une décision 2 lue dans l'événement du
 * contrat, sur réseau de test ; l'appelant passe « refuse » pour tout ce qu'il
 * ne sait pas lire (domain/reasons.ts, readDecision).
 */
export function PastilleDecision({ tone, large = false }: { tone: Tone; large?: boolean }) {
  const sign = SIGNS[tone];
  return (
    <span className={`veto-decision veto-decision-${tone}${large ? " veto-decision-grand" : ""}`} data-testid="pastille-decision">
      <span className="veto-decision-signe">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {GLYPHS[sign.glyph]}
        </svg>
      </span>
      {sign.digit !== null && <span className="veto-decision-num">{sign.digit}</span>}
      {sign.word}
    </span>
  );
}
