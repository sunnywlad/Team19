// L'échéance d'un cas en attente : jusqu'à quand un humain peut trancher. Les
// deux bornes viennent du contrat, en heure de bloc : le bloc de la décision 1
// et l'échéance inscrite dans HoldPlaced. Rien n'est calculé ici en jours
// ouvrés : le dashboard affiche l'échéance qu'on lui donne.

export const CASES = 24;

export type DeadlineState = "normal" | "proche" | "echue";

export type DeadlineView = {
  state: DeadlineState;
  /** Secondes restantes à l'instant affiché, 0 une fois l'échéance passée. */
  remainingS: number;
  /** Cases encore pleines, sur CASES. Une case vaut 1/24 du délai. */
  casesOn: number;
  /** Durée du délai, de la décision 1 à l'échéance, en secondes. */
  windowS: number;
};

/**
 * Part du délai d'approbation qui reste, de 0 à 1. null : l'une des deux bornes
 * manque, ou la fenêtre est vide.
 */
export function remainingShare(deadline: number | null, decidedAt: number, nowSeconds: number): number | null {
  if (deadline === null) return null;
  const window = deadline - decidedAt;
  if (window <= 0) return null;
  return Math.min(1, Math.max(0, (deadline - nowSeconds) / window));
}

/**
 * Pas d'affichage, en secondes : l'écran ne change que lorsque ce qu'il montre
 * change. Le temps restant s'écrit à la minute, donc une minute suffit dès
 * qu'une case dure au moins une minute (délai de 24 min ou plus). Pour un délai
 * plus court, comme les 30 s de la démo, le pas est la durée d'une case : sans
 * cela la jauge resterait figée jusqu'à l'échéance.
 */
export function displayStep(windowS: number): number {
  return Math.max(1, Math.min(60, Math.floor(windowS / CASES)));
}

/**
 * Ce que l'écran montre pour une échéance. L'instant est arrondi vers le bas au
 * pas d'affichage, sauf pour constater l'échéance : dès qu'elle est passée,
 * l'état est « échue », sans attendre le pas suivant. null : borne manquante.
 */
export function deadlineView(deadline: number | null, decidedAt: number, nowSeconds: number): DeadlineView | null {
  if (deadline === null) return null;
  const windowS = deadline - decidedAt;
  if (windowS <= 0) return null;
  if (nowSeconds >= deadline) return { state: "echue", remainingS: 0, casesOn: 0, windowS };
  const step = displayStep(windowS);
  // Aligné sur la décision : la première case s'éteint un pas après elle.
  const shown = Math.max(decidedAt, decidedAt + Math.floor((nowSeconds - decidedAt) / step) * step);
  const share = remainingShare(deadline, decidedAt, shown) ?? 0;
  return { state: share <= 0.25 ? "proche" : "normal", remainingS: deadline - shown, casesOn: Math.floor(share * CASES), windowS };
}

/** Temps restant en heures et minutes, jamais en secondes : « 20 h 12 », « 12 min », « moins d'1 min ». */
export function formatHoursMinutes(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
  return minutes >= 1 ? `${minutes} min` : "moins d'1 min";
}

/** Durée d'un délai, un fait et non un compte à rebours : « 24 h », « 1 h 30 », « 45 min », « 30 s ». */
export function formatWindow(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}
