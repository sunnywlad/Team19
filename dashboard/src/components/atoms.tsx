// Briques d'affichage. Toute valeur venue d'une API passe par l'une d'elles :
// identifiant abrégé, montant ou « non disponible », texte non fiable inerte.
import type { ReactNode } from "react";
import type { Source } from "../api/types.ts";
import { DECISION_WORDS, type DecisionKind } from "../domain/reasons.ts";
import { UNIT_LABEL, abbreviateId, formatWei } from "../lib/format.ts";
import { EXCERPT_MAX, neutralize } from "../lib/safeText.ts";

/** Texte venu d'ailleurs : borné, caractères invisibles rendus visibles, monospace, jamais interprété. */
export function Untrusted({ text, max = EXCERPT_MAX }: { text: string; max?: number }) {
  const safe = neutralize(text, max);
  return (
    <span className="non-fiable">
      {safe.text}
      {safe.truncated ? "…" : ""}
    </span>
  );
}

/** Identifiant opaque abrégé (0x1234…abcd). Une valeur hors format n'est jamais affichée telle quelle. */
export function OpaqueId({ value, missing = "—" }: { value: string | null | undefined; missing?: string }) {
  if (value === null || value === undefined) return <span className="discret">{missing}</span>;
  const short = abbreviateId(value);
  if (short === null) {
    return (
      <span className="hors-format">
        valeur hors format : <Untrusted text={value} max={24} />
      </span>
    );
  }
  return <code className="identifiant">{short}</code>;
}

/** Montant renvoyé par l'API. Absent : « non disponible », jamais 0. */
export function Amount({ wei, missing = "non disponible" }: { wei: string | null | undefined; missing?: string }) {
  const text = formatWei(wei);
  if (text === null) return <span className="indisponible">{missing}</span>;
  return (
    <span className="montant">
      {text}
      <span className="unite"> {UNIT_LABEL}</span>
    </span>
  );
}

const ICONS: Record<DecisionKind, ReactNode> = {
  // Croix : refusé.
  refuse: <path d="M5 5l10 10M15 5L5 15" />,
  // Sablier : en attente d'un humain.
  humain: <path d="M6 3h8M6 17h8M7 3c0 4 6 4 6 7s-6 3-6 7M13 3c0 4-6 4-6 7s6 3 6 7" />,
  // Coche : accepté.
  accepte: <path d="M4 10.5l4 4 8-9" />,
};

/** La décision en mots, avec une icône : la couleur ne porte jamais seule l'information. */
export function DecisionBadge({ kind }: { kind: DecisionKind }) {
  return (
    <span className={`decision decision-${kind}`}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        {ICONS[kind]}
      </svg>
      {DECISION_WORDS[kind]}
    </span>
  );
}

export function SourceTag({ source }: { source: Source }) {
  return source === "reel" ? (
    <span className="source source-reel">réel</span>
  ) : (
    <span className="source source-simulation" title="Point d'accès simulé : voir API-NEEDS.md">
      simulation
    </span>
  );
}

export function ClockTag({ clock }: { clock: "journal" | "bloc" | "locale" }) {
  const text = clock === "journal" ? "horloge : journal" : clock === "bloc" ? "horloge : bloc" : "horloge : locale";
  return <span className={`horloge horloge-${clock}`}>{text}</span>;
}
