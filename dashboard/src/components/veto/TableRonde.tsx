import { SEAT_LABELS, SEAT_STATE_WORDS, describeSeats, type Seat, type SeatKey, type SeatState } from "../../domain/table.ts";
import { GLYPHS, Icon, type GlyphName } from "./glyphs.tsx";

// Géométrie reprise du logo : table ovale, V, cinq sièges tournés vers le centre.
// Dessinée pour 360 × 200, mise à l'échelle par la feuille de style. Tout est en
// attributs SVG : aucun style en ligne.
const PLACES: Record<SeatKey, { x: number; y: number; angle: number }> = {
  porte: { x: 42, y: 128, angle: -90 },
  ia: { x: 82, y: 63.4, angle: -32.7 },
  relais: { x: 180, y: 38, angle: 0 },
  contrat: { x: 278, y: 63.4, angle: 32.7 },
  humain: { x: 318, y: 128, angle: 90 },
};

const SEAT_GLYPHS: Partial<Record<SeatState, GlyphName>> = { passe: "coche", veto: "croix", attente: "sablier" };

/**
 * La table ronde : l'état des cinq couches pour une demande. Elle ne montre que
 * des faits (domain/table.ts) ; la légende redit chaque siège en mots, avec le
 * code du motif sur celui qui a statué. `fresh` : le siège qui vient de changer,
 * animé une fois.
 */
export function TableRonde({ seats, fresh = null }: { seats: Seat[]; fresh?: SeatKey | null }) {
  return (
    <figure className="table-ronde-bloc" data-testid="table-ronde">
      <svg className="table-ronde" viewBox="0 0 360 200" role="img" aria-label={describeSeats(seats)}>
        <ellipse className="tr-table" cx={180} cy={128} rx={104} ry={56} />
        <path className="tr-v" d="M152 104H170L180 128L190 104H208L186 152H174Z" />
        {seats.map((seat) => {
          const place = PLACES[seat.key];
          const glyph = SEAT_GLYPHS[seat.state];
          return (
            <g
              key={seat.key}
              className={`siege siege-${seat.state}${fresh === seat.key ? " siege-nouveau" : ""}`}
              transform={`translate(${place.x} ${place.y}) rotate(${place.angle})`}
            >
              <g className="siege-mouv">
                <rect className="siege-bras" x={-27} y={-12} width={7} height={28} rx={3.5} />
                <rect className="siege-bras" x={20} y={-12} width={7} height={28} rx={3.5} />
                <rect className="siege-corps" x={-17} y={-20} width={34} height={36} rx={8} />
                {glyph && (
                  // Le glyphe reste droit : on défait la rotation du siège.
                  <g transform={`translate(0 -2) rotate(${-place.angle})`}>
                    <g className="siege-glyphe" transform="translate(-9 -9) scale(0.75)">
                      {GLYPHS[glyph]}
                    </g>
                  </g>
                )}
              </g>
            </g>
          );
        })}
      </svg>
      <ol className="table-legende">
        {seats.map((seat) => {
          const glyph = SEAT_GLYPHS[seat.state];
          return (
            <li key={seat.key} data-testid={`siege-${seat.key}`} data-etat={seat.state}>
              <strong>{SEAT_LABELS[seat.key]}</strong>
              <span className={`etat-mot t-${seat.state}`}>
                {glyph && <Icon name={glyph} small />}
                {SEAT_STATE_WORDS[seat.state]}
              </span>
              {seat.code !== null && <code className="discret">{seat.code}</code>}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
