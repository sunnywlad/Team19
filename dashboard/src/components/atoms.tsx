// Briques d'affichage. Toute valeur venue d'une API passe par l'une d'elles :
// identifiant abrégé, montant ou « non disponible », texte non fiable inerte.
import { useContext, type ReactNode } from "react";
import type { TagSource } from "../api/types.ts";
import { TONE_WORDS, type Tone } from "../domain/flow.ts";
import { DECISION_WORDS, type DecisionKind } from "../domain/reasons.ts";
import { useAffichage } from "../hooks/useAffichage.ts";
import { ProvenanceContext } from "../hooks/useProvenance.ts";
import { abbreviateId, formatAmount, formatTime } from "../lib/format.ts";
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

/** Montant renvoyé par l'API, dans l'unité déclarée par le proxy local. Absent : « non disponible », jamais 0. */
export function Amount({ wei, missing = "non disponible" }: { wei: string | null | undefined; missing?: string }) {
  const { unite } = useAffichage();
  const text = formatAmount(wei, unite);
  if (text === null) return <span className="indisponible">{missing}</span>;
  return (
    <span className="montant">
      {text}
      <span className="unite"> {unite.symbole}</span>
    </span>
  );
}

const ICONS: Record<Tone, ReactNode> = {
  // Croix : refusé.
  refuse: <path d="M5 5l10 10M15 5L5 15" />,
  // Sablier : en attente d'un humain.
  humain: <path d="M6 3h8M6 17h8M7 3c0 4 6 4 6 7s-6 3-6 7M13 3c0 4-6 4-6 7s6 3 6 7" />,
  // Coche : accepté.
  accepte: <path d="M4 10.5l4 4 8-9" />,
  // Sens interdit : arrêté à la porte d'entrée.
  bloque: <path d="M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14M5.5 10h9" />,
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

/** Issue d'une demande, y compris l'arrêt à la porte : icône et mot, comme DecisionBadge. */
export function ToneBadge({ tone }: { tone: Tone }) {
  return (
    <span className={`decision decision-${tone}`}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        {ICONS[tone]}
      </svg>
      {TONE_WORDS[tone]}
    </span>
  );
}

/** Familles de données, nommées comme dans le panneau « Sources ». */
export type Famille = "relay" | "vault" | "response";
export const FAMILLE_NOMS: Record<Famille, string> = { relay: "relais", vault: "coffre", response: "service de réponse" };

/** Le mot de chaque provenance. « réel » seulement quand la source l'est : jamais par défaut. */
export const SOURCE_MOTS: Record<TagSource, string> = {
  reel: "réel",
  simulation: "simulation",
  "faux-coffre": "simulation (faux coffre en mémoire : aucun fonds, aucune chaîne)",
  "non-confirme": "origine non confirmée",
};

const SOURCE_ICONES: Record<TagSource, ReactNode> = {
  // Disque plein coché : lu en direct.
  reel: <path d="M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2M5.5 8.2l1.7 1.7 3.3-3.6" />,
  // Cercle en pointillés autour d'un point : point d'accès simulé.
  simulation: <path d="M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2M8 6.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8" />,
  "faux-coffre": <path d="M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2M8 6.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8" />,
  // Point d'interrogation : le proxy ne l'a pas dit.
  "non-confirme": <path d="M8 2a6 6 0 1 0 0 12A6 6 0 1 0 8 2M6.4 6.3a1.7 1.7 0 1 1 2.3 1.6c-.5.2-.7.6-.7 1.1M8 11v.1" />,
};

/** Ce que l'icône de provenance dit en mots : « Source : relais, réel, lu à 14:30:13 ». */
export function sourceTexte(source: TagSource, famille?: Famille, lu?: number | null): string {
  const parts = [famille ? FAMILLE_NOMS[famille] : null, SOURCE_MOTS[source]];
  if (lu !== undefined) parts.push(lu === null ? "jamais lu" : `lu à ${formatTime(lu)}`);
  return `Source : ${parts.filter((p) => p !== null).join(", ")}`;
}

/**
 * Provenance d'un panneau : une icône discrète, le mot dans l'infobulle et le
 * texte accessible. Un clic ouvre le panneau « Sources » de la barre haute.
 * Seule « origine non confirmée » reste écrite à l'écran, en petit.
 */
export function SourceTag({ source, famille, lu }: { source: TagSource; famille?: Famille; lu?: number | null }) {
  const { ouvrirSources } = useContext(ProvenanceContext);
  const texte = sourceTexte(source, famille, lu);
  const kind = source === "reel" ? "reel" : source === "non-confirme" ? "non-confirme" : "simulation";
  return (
    <button type="button" className={`source source-${kind}`} data-ui="affichage" data-provenance={source} title={texte} onClick={ouvrirSources}>
      <svg className="ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {SOURCE_ICONES[source]}
      </svg>
      <span className="visuellement-cache">{texte}</span>
      {source === "non-confirme" && (
        <span className="source-mot" aria-hidden="true">
          origine non confirmée
        </span>
      )}
    </button>
  );
}

const CLOCK_TEXT = { journal: "horloge : journal", bloc: "horloge : bloc", locale: "horloge : locale" } as const;

/** Horloge d'un horodatage : une petite icône, le mot dans l'infobulle. `visible` l'écrit, pour une colonne qui la nomme. */
export function ClockTag({ clock, visible = false }: { clock: "journal" | "bloc" | "locale"; visible?: boolean }) {
  const text = CLOCK_TEXT[clock];
  if (visible) return <span className={`horloge horloge-${clock}`}>{text}</span>;
  return (
    <span className={`horloge-icone horloge-${clock}`} title={text}>
      <svg className="ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M8 5v3l2 1.2" />
      </svg>
      <span className="visuellement-cache">{text}</span>
    </span>
  );
}

/** Notes techniques d'un panneau (formules, horloges, calculs) : repliées par défaut, contenu inchangé. */
export function Details({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <details className="details-tech" data-testid={testId}>
      <summary>Détails</summary>
      <div className="details-corps">{children}</div>
    </details>
  );
}

/** État vide : une phrase utile, et ce qui le fera changer. */
export function Vide({ children, hint, className }: { children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={`vide${className ? ` ${className}` : ""}`}>
      <p className="vide-titre">{children}</p>
      {hint !== undefined && <p className="vide-aide">{hint}</p>}
    </div>
  );
}
