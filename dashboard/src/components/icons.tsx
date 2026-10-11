// Icônes en SVG en ligne (aucune ressource externe). Toujours accompagnées d'un
// mot : une icône ne porte jamais seule un statut.
import type { ReactNode } from "react";

const PATHS = {
  // Coche : passé, payé, sain.
  passe: <path d="M4 10.5l4 4 8-9" />,
  // Croix : veto, refus.
  veto: <path d="M5 5l10 10M15 5L5 15" />,
  // Sablier : attente d'un humain.
  attente: <path d="M6 3h8M6 17h8M7 3c0 4 6 4 6 7s-6 3-6 7M13 3c0 4-6 4-6 7s6 3 6 7" />,
  // Cercle vide : non atteint.
  "non-atteint": <circle cx="10" cy="10" r="5" />,
  // Tiret : non disponible.
  inconnu: <path d="M5 10h10" />,
  // Flèche qui sort : montant sorti.
  sortie: <path d="M4 10h10M10 5l5 5-5 5M3 4v12" />,
  // Cadenas : montant bloqué.
  bloque: <path d="M6 9V6.5a4 4 0 0 1 8 0V9M4.5 9h11v8h-11z" />,
  // Deux barres : pause.
  pause: <path d="M7 4v12M13 4v12" />,
  // Coffre : rectangle et molette.
  coffre: <path d="M3 4h14v12H3zM10 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M5 16v1.5M15 16v1.5" />,
  // Cloche : alerte.
  alerte: <path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 1.5h-13zM8.5 17.5h3" />,
  // Flèche vers le bas : téléchargement.
  telecharger: <path d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 17h12" />,
  // Clé : pouvoir.
  cle: <path d="M8 8a4 4 0 1 0 0 .01M11 9.5l6 6M14.5 13l-2 2M16.5 15l-1.5 1.5" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icone" viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/**
 * Marque Veto : une table ovale, cinq sièges, un V. Les cinq sièges sont les
 * cinq couches réelles du flux ; le dessin ne prétend rien de plus.
 */
export function VetoMark({ size = 44 }: { size?: number }) {
  return (
    <svg className="marque-svg" viewBox="0 0 64 44" width={size} height={(size * 44) / 64} aria-hidden="true" focusable="false">
      <g className="marque-sieges">
        <rect x="6" y="9" width="9" height="8" rx="2" transform="rotate(-28 10.5 13)" />
        <rect x="18" y="2" width="9" height="8" rx="2" transform="rotate(-10 22.5 6)" />
        <rect x="37" y="2" width="9" height="8" rx="2" transform="rotate(10 41.5 6)" />
        <rect x="49" y="9" width="9" height="8" rx="2" transform="rotate(28 53.5 13)" />
        <rect x="27.5" y="0.5" width="9" height="8" rx="2" />
      </g>
      <ellipse className="marque-table" cx="32" cy="28" rx="25" ry="13" />
      <path className="marque-v" d="M24.5 21.5L32 35l7.5-13.5" />
    </svg>
  );
}
