import { formatRemaining } from "../lib/format.ts";

/**
 * Part du délai d'approbation qui reste, de 0 à 1. La fenêtre va du bloc de la
 * décision 1 à l'échéance inscrite dans HoldPlaced, toutes deux sur l'horloge
 * des blocs. null : l'une des deux bornes manque, ou la fenêtre est vide.
 */
export function remainingShare(deadline: number | null, decidedAt: number, nowSeconds: number): number | null {
  if (deadline === null) return null;
  const window = deadline - decidedAt;
  if (window <= 0) return null;
  return Math.min(1, Math.max(0, (deadline - nowSeconds) / window));
}

type Props = { deadline: number | null; decidedAt: number; now: number };

/**
 * Anneau de compte à rebours d'un cas en attente. Purement visuel : le délai
 * restant est écrit à côté, en mots. Sans échéance lue, aucun anneau.
 */
export function CountdownRing({ deadline, decidedAt, now }: Props) {
  const nowSeconds = Math.floor(now / 1000);
  const share = remainingShare(deadline, decidedAt, nowSeconds);
  if (share === null || deadline === null) {
    return (
      <span className="anneau anneau-absent" data-testid="anneau" data-part="aucune">
        —
      </span>
    );
  }
  const remaining = Math.max(0, deadline - nowSeconds);
  const percent = Math.round(share * 1000) / 10;
  const level = share === 0 ? "echu" : share <= 0.25 ? "urgent" : "normal";
  return (
    <span className={`anneau anneau-${level}`} data-testid="anneau" data-part={String(percent)} aria-hidden="true">
      <svg viewBox="0 0 64 64" width="64" height="64" focusable="false">
        <circle className="anneau-fond" cx="32" cy="32" r="27" />
        <circle
          className="anneau-reste"
          cx="32"
          cy="32"
          r="27"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={String(100 - percent)}
          transform="rotate(-90 32 32)"
        />
        <text className="anneau-texte" x="32" y="36" textAnchor="middle">
          {share === 0 ? "échu" : formatRemaining(remaining).replace(" min ", "′").replace(" s", "″")}
        </text>
      </svg>
    </span>
  );
}
