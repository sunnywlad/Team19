// Glyphes du système Veto, tracés sur une grille de 24 : la couleur vient du
// parent (currentColor), le sens vient du glyphe et du mot qui l'accompagne.
import type { ReactNode } from "react";

export const GLYPHS = {
  // Coche : passé, payé, sain.
  coche: <path d="M5 12.5l4.5 4.5L19 7" />,
  // Croix : veto, refus.
  croix: <path d="M6 6l12 12M18 6L6 18" />,
  // Sablier : en attente d'un humain.
  sablier: <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" />,
  // Sens interdit : arrêté à la porte d'entrée.
  barre: <path d="M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M7 12h10" />,
  // Cadre en pointillé : quarantaine, agent écarté.
  quarantaine: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3" />
      <path d="M9 12h6" />
    </>
  ),
  // Clé barrée : ce tableau ne détient aucune clé.
  "sans-cle": (
    <>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12H20M17 12v3M4 4l16 16" />
    </>
  ),
} as const satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof GLYPHS;

/** Icône décorative : le mot à côté porte le sens pour un lecteur d'écran. */
export function Icon({ name, small = false }: { name: GlyphName; small?: boolean }) {
  return (
    <svg className={small ? "veto-icone veto-icone-sm" : "veto-icone"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {GLYPHS[name]}
    </svg>
  );
}
