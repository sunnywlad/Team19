// Pastille « en pause » d'un agent : icône et mot, la couleur n'est jamais seule.
// Elle pulse tant que l'agent est en pause, c'est-à-dire tant que les données
// le disent ; mouvement réduit : la pulsation est coupée.
export function PauseBadge({ scopes }: { scopes: string[] }) {
  return (
    <span className="pastille-pause" data-testid="pastille-pause">
      <span className="pastille-pause-point" aria-hidden="true" />
      <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M7 4v12M13 4v12" />
      </svg>
      en pause{scopes.length > 0 ? ` · ${scopes.join(", ")}` : ""}
    </span>
  );
}
