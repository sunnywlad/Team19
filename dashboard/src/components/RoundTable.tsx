// Table ronde : une table ovale, un siège par couche réelle, le verdict de
// chaque couche et son motif. Les filets entre les sièges s'allument quand une
// couche a laissé passer la demande. Mouvement seulement quand un verdict
// change pour la même demande ; changer de demande ne fait rien bouger.
import { useRef, type ReactNode } from "react";
import { overall as overallOf, SEATS, VERDICT_WORDS, type Overall, type Seat, type SeatKey, type Verdict } from "../domain/table.ts";
import { OpaqueId } from "./atoms.tsx";
import { Icon, type IconName } from "./icons.tsx";

export const VERDICT_ICONS: Record<Verdict, IconName> = {
  passe: "passe",
  veto: "veto",
  attente: "attente",
  "non-atteint": "non-atteint",
  inconnu: "inconnu",
};

/** Sièges et filets, dans le repère du dessin (1000 × 500). */
const CHAIRS: Record<SeatKey, { x: number; y: number; angle: number }> = {
  porte: { x: 210, y: 250, angle: 90 },
  ia: { x: 334, y: 137, angle: -35 },
  relais: { x: 666, y: 137, angle: 35 },
  contrat: { x: 790, y: 250, angle: 90 },
  humain: { x: 500, y: 388, angle: 0 },
};

/** Filet du siège i au siège i + 1, le long de l'ovale des sièges. */
const LINKS: { from: SeatKey; to: SeatKey; d: string }[] = [
  { from: "porte", to: "ia", d: "M210 250 A290 138 0 0 1 334 137" },
  { from: "ia", to: "relais", d: "M334 137 A290 138 0 0 1 666 137" },
  { from: "relais", to: "contrat", d: "M666 137 A290 138 0 0 1 790 250" },
  { from: "contrat", to: "humain", d: "M790 250 A290 138 0 0 1 500 388" },
];

/** Vrai si « value » a changé depuis le premier rendu de ce composant. */
function useChanged(value: string): boolean {
  const first = useRef(value);
  const moved = useRef(false);
  if (value !== first.current) moved.current = true;
  return moved.current;
}

function SeatCard({ seat }: { seat: Seat }) {
  const changed = useChanged(seat.verdict);
  return (
    <li className={`siege siege-${seat.key} verdict-${seat.verdict}`} data-testid={`siege-${seat.key}`} data-verdict={seat.verdict}>
      <span key={seat.verdict} className={changed ? "siege-corps siege-change" : "siege-corps"}>
        <span className="siege-nom">{seat.label}</span>
        <span className="siege-verdict">
          <Icon name={VERDICT_ICONS[seat.verdict]} />
          {VERDICT_WORDS[seat.verdict]}
        </span>
        <span className="siege-motif">{seat.reason}</span>
      </span>
    </li>
  );
}

type Props = {
  seats: Seat[];
  requestId: string | null;
  /** Ligne sous le verdict, au centre de la table : montant, demande. */
  detail?: ReactNode;
  /** Étiquette « illustration » : la table ne montre pas des données lues. */
  illustration?: boolean;
};

export function RoundTable({ seats, requestId, detail, illustration = false }: Props) {
  const result: Overall = overallOf(seats);
  const byKey = new Map(seats.map((s) => [s.key, s]));
  return (
    <figure className={`table-ronde issue-${result.verdict}`} data-testid="table-ronde" data-issue={result.verdict}>
      <div className="table-scene">
        <svg className="table-svg" viewBox="0 0 1000 500" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
          <ellipse className="table-anneau" cx="500" cy="250" rx="290" ry="138" />
          {LINKS.map((link) => {
            const from = byKey.get(link.from)?.verdict;
            const to = byKey.get(link.to)?.verdict;
            // Allumé : la couche de départ a laissé passer, et la suivante a reçu la demande.
            const lit = from === "passe" && to !== "non-atteint";
            return (
              <g key={link.from} className={lit ? "filet filet-allume" : "filet"} data-filet={`${link.from}-${link.to}`} data-etat={lit ? "allume" : "eteint"}>
                <path className="filet-fond" d={link.d} />
                <path className="filet-lumiere" d={link.d} />
              </g>
            );
          })}
          <ellipse className="table-plateau" cx="500" cy="250" rx="215" ry="92" />
          <ellipse className="table-lisere" cx="500" cy="250" rx="200" ry="80" />
          {SEATS.map(({ key }) => {
            const c = CHAIRS[key];
            const verdict = byKey.get(key)?.verdict ?? "inconnu";
            return (
              <g key={key} className={`chaise verdict-${verdict}`} transform={`translate(${c.x} ${c.y}) rotate(${c.angle})`}>
                <rect x="-24" y="-11" width="48" height="22" rx="7" />
              </g>
            );
          })}
        </svg>
        <div className="table-centre">
          {illustration && <span className="source source-simulation">illustration</span>}
          <p className="table-issue" data-testid="table-issue">
            <Icon name={result.verdict === "veto" ? "veto" : result.verdict === "attente" ? "attente" : result.verdict === "passe" ? "passe" : "inconnu"} size={20} />
            {result.text}
          </p>
          {detail ?? (requestId !== null && (
            <p className="table-detail">
              demande <OpaqueId value={requestId} />
            </p>
          ))}
        </div>
        <ol className="sieges" aria-label="Couches, dans l'ordre du flux">
          {seats.map((seat) => (
            <SeatCard key={seat.key} seat={seat} />
          ))}
        </ol>
      </div>
      <p className="visuellement-cache" aria-live="polite" data-testid="table-annonce">
        {result.text}
      </p>
    </figure>
  );
}
