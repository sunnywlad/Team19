import type { VaultState } from "../api/types.ts";
import { formatWei, UNIT_LABEL } from "../lib/format.ts";

const WEI = /^(0|[1-9][0-9]{0,77})$/;
const SCALE = 1000n;

type Segment = { key: string; label: string; wei: string };

/** Les quatre termes, dans l'ordre de la formule du contrat. */
function segments(vault: VaultState): Segment[] | null {
  const terms: [string, string, string | null][] = [
    ["dettes", "Dettes admises", vault.admitted_debts_wei],
    ["reserve", "Réserve de sécurité", vault.safety_reserve_wei],
    ["placements-bloques", "Placements bloqués", vault.held_placements_wei],
    ["placable", "Plaçable", vault.placeable_wei],
  ];
  const out: Segment[] = [];
  for (const [key, label, wei] of terms) {
    if (wei === null || !WEI.test(wei)) return null;
    out.push({ key, label, wei });
  }
  return out;
}

/**
 * Barre empilée : cash = dettes admises + réserve + placements bloqués + plaçable,
 * chaque terme tel que la vue du contrat le renvoie. La largeur d'un segment est
 * sa part de la barre ; aucun terme n'est recalculé. Une facture bloquée reste
 * une dette admise : « montant bloqué » n'y figure pas, il serait compté deux fois.
 */
export function PlaceableBar({ vault }: { vault: VaultState }) {
  const parts = segments(vault);
  const cash = vault.cash_wei !== null && WEI.test(vault.cash_wei) ? BigInt(vault.cash_wei) : null;
  if (parts === null || cash === null) {
    return (
      <p className="barre-absente indisponible" data-testid="barre-placable" data-etat="non-mesure">
        Répartition du cash : Non mesuré (une vue du contrat n'a pas été lue).
      </p>
    );
  }
  const sum = parts.reduce((total, p) => total + BigInt(p.wei), 0n);
  const scale = sum > cash ? sum : cash;
  if (scale === 0n) {
    return (
      <p className="barre-absente indisponible" data-testid="barre-placable" data-etat="vide">
        Répartition du cash : cash nul, rien à répartir.
      </p>
    );
  }
  let x = 0n;
  const drawn = parts.map((p) => {
    const width = (BigInt(p.wei) * SCALE) / scale;
    const segment = { ...p, x: Number(x), width: Number(width) };
    x += width;
    return segment;
  });
  const summary = drawn.map((p) => `${p.label} ${formatWei(p.wei)} ${UNIT_LABEL}`).join(", ");
  return (
    <figure className="barre" data-testid="barre-placable" data-etat={sum === cash ? "egal" : "ecart"}>
      <svg className="barre-svg" viewBox="0 0 1000 28" preserveAspectRatio="none" role="img" aria-label={`Répartition du cash : ${summary}`} focusable="false">
        <rect className="barre-fond" x="0" y="0" width="1000" height="28" rx="8" />
        {drawn.map((p) => (
          <rect
            key={p.key}
            className={`barre-segment segment-${p.key}`}
            data-segment={p.key}
            data-part={String(p.width / 10)}
            x={p.x}
            y="0"
            width={p.width}
            height="28"
          />
        ))}
      </svg>
      <figcaption>
        <ul className="barre-legende">
          {drawn.map((p) => (
            <li key={p.key}>
              <span className={`pastille-legende segment-${p.key}`} aria-hidden="true" />
              {p.label} <strong>{formatWei(p.wei)} {UNIT_LABEL}</strong>
            </li>
          ))}
        </ul>
        {sum !== cash && (
          <p className="alerte-ligne" data-testid="barre-ecart">
            Les termes lus ne somment pas au cash : la barre est tracée à l'échelle de leur somme, sans rien corriger.
          </p>
        )}
      </figcaption>
    </figure>
  );
}
