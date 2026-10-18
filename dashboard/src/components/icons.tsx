// Icônes de la console, tracées sur une grille de 16 (docs/console/reference-veto-console.html).
// Décoratives : le mot à côté porte le sens. La couleur vient du parent.
import type { ReactNode } from "react";

const ICONS = {
  apercu: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  valider: <path d="M2 9.5V13h12V9.5M2 9.5l2-6.5h8l2 6.5M2 9.5h3.5l1 1.5h3l1-1.5H14" />,
  incident: (
    <>
      <path d="M8 2 1.8 13h12.4z" />
      <path d="M8 6.5v3M8 11.5v.1" />
    </>
  ),
  batiment: <path d="M2.5 14V3.5h7V14M9.5 7h4v7M1.5 14h13M5 6h2M5 9h2M5 12h2M11.5 10h.1" />,
  agent: (
    <>
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
      <path d="M6.5 1.5V4M9.5 1.5V4M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5" />
    </>
  ),
  regles: (
    <>
      <path d="M2 4h7M12 4h2M2 12h3M8 12h6" />
      <circle cx="10.5" cy="4" r="1.5" />
      <circle cx="6.5" cy="12" r="1.5" />
    </>
  ),
  journal: (
    <>
      <path d="M4 2h8v12H4z" />
      <path d="M6 5h4M6 8h4M6 11h2" />
    </>
  ),
  campagne: <path d="M2 14h12M4 11V8M7 11V4M10 11V6M13 11V2.5" />,
  check: <path d="m3 8.5 3 3 7-7" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  horloge: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  pause: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.5 5.8v4.4M9.5 5.8v4.4" />
    </>
  ),
  chevron: <path d="m6 4 4 4-4 4" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2V11M8 5v.1" />
    </>
  ),
  doute: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8v3.6M8 11v.1" />
    </>
  ),
  lien: <path d="M7 9a3 3 0 0 0 4.2 0l2-2A3 3 0 0 0 9 2.8L8 3.8M9 7a3 3 0 0 0-4.2 0l-2 2A3 3 0 0 0 7 13.2l1-1" />,
  mobile: (
    <>
      <rect x="4" y="1.5" width="8" height="13" rx="1.8" />
      <path d="M7 12.5h2" />
    </>
  ),
  "cle-barree": (
    <>
      <circle cx="5" cy="8" r="2.8" />
      <path d="M7.8 8h6.7M12 8v2.2M2 2l12 12" />
    </>
  ),
  oeil: <path d="M1.2 8S4 3.2 8 3.2 14.8 8 14.8 8 12 12.8 8 12.8 1.2 8 1.2 8zM8 6a2 2 0 1 0 0 4a2 2 0 1 0 0-4" />,
  "theme-systeme": <path d="M8 2.4a5.6 5.6 0 1 0 0 11.2a5.6 5.6 0 1 0 0-11.2M8 2.4v11.2M8 5.2h4.7M8 8h5.6M8 10.8h4.7" />,
  "theme-clair": <path d="M8 5.2a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M3.4 12.6l1.2-1.2M11.4 4.6l1.2-1.2" />,
  "theme-sombre": <path d="M13.2 9.2A5.2 5.2 0 0 1 6.8 2.8a5.2 5.2 0 1 0 6.4 6.4z" />,
  document: (
    <>
      <path d="M4 1.5h5.5L12 4v10.5H4z" />
      <path d="M9.5 1.5V4H12M6 7.5h4M6 10h4" />
    </>
  ),
} as const satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = "ic" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  );
}
