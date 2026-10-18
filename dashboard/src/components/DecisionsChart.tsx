// Décisions par jour : barres empilées en SVG, couleurs par classe (jetons
// serie-*), aucune donnée dans un attribut de style. La légende redit chaque
// série en mots ; un tableau caché à l'œil donne les mêmes nombres aux lecteurs
// d'écran. Chaque barre porte une infobulle native (<title>).
import { chartMax, type Day } from "../domain/apercu.ts";

const W = 720;
const H = 240;
const LEFT = 34;
const RIGHT = 8;
const TOP = 10;
const BOTTOM = 26;
const PLOT_W = W - LEFT - RIGHT;
const PLOT_H = H - TOP - BOTTOM;

const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "numeric" });
const DAY_LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

export const SERIES = [
  { key: "auto", label: "Payés automatiquement", className: "serie-auto" },
  { key: "approved", label: "Payés après validation", className: "serie-validee" },
  { key: "blocked", label: "Bloqués", className: "serie-bloquee" },
] as const;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function describe(day: Day): string {
  return `${DAY_LONG.format(new Date(day.startMs))} : ${plural(day.auto, "payé automatiquement", "payés automatiquement")}, ${plural(
    day.approved,
    "payé après validation",
    "payés après validation",
  )}, ${plural(day.blocked, "bloqué", "bloqués")}`;
}

export function DecisionsChart({ days }: { days: Day[] }) {
  const max = chartMax(days);
  const ticks = [0, 1, 2, 3, 4].map((i) => (max * i) / 4);
  const slot = PLOT_W / Math.max(1, days.length);
  const barW = Math.max(4, Math.min(28, slot * 0.6));
  const y = (value: number): number => TOP + PLOT_H - (value / max) * PLOT_H;
  // Une étiquette tous les `every` jours, et toujours la dernière (aujourd'hui).
  const every = Math.max(1, Math.ceil(days.length / 7));
  const totals = days.reduce((t, d) => ({ auto: t.auto + d.auto, approved: t.approved + d.approved, blocked: t.blocked + d.blocked }), { auto: 0, approved: 0, blocked: 0 });
  const summary = `Décisions par jour, ${days.length} derniers jours : ${plural(totals.auto, "payé automatiquement", "payés automatiquement")}, ${plural(
    totals.approved,
    "payé après validation",
    "payés après validation",
  )}, ${plural(totals.blocked, "bloqué", "bloqués")}.`;

  return (
    <figure className="graphe" data-testid="graphe-jours">
      {totals.auto + totals.approved + totals.blocked === 0 && (
        <p className="graphe-vide" data-testid="graphe-vide">
          Aucune décision sur ces {days.length} jours. Le graphique se remplit à la première.
        </p>
      )}
      <svg className="graphe-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} focusable="false">
        {ticks.map((t) => (
          <g key={t}>
            <line className="graphe-grille" x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} />
            <text className="graphe-axe" x={LEFT - 8} y={y(t) + 4} textAnchor="end">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {days.map((day, i) => {
          const x = LEFT + i * slot + (slot - barW) / 2;
          let base = 0;
          return (
            <g key={day.startMs} className="graphe-jour" data-jour={i}>
              <title>{describe(day)}</title>
              {/* Zone de survol pleine hauteur : l'infobulle répond aussi au-dessus d'une barre courte. */}
              <rect className="graphe-survol" x={LEFT + i * slot} y={TOP} width={slot} height={PLOT_H} />
              {SERIES.map((s) => {
                const value = day[s.key];
                if (value === 0) return null;
                const top = y(base + value);
                const height = y(base) - top;
                base += value;
                return <rect key={s.key} className={`graphe-barre ${s.className}`} data-serie={s.key} x={x} y={top} width={barW} height={Math.max(1, height - 1)} rx={2} />;
              })}
              {(i % every === every - 1 || i === days.length - 1) && (
                <text className="graphe-axe" x={LEFT + i * slot + slot / 2} y={H - 8} textAnchor="middle">
                  {DAY.format(new Date(day.startMs))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption>
        <ul className="legende">
          {SERIES.map((s) => (
            <li key={s.key}>
              <i className={`legende-puce ${s.className}`} aria-hidden="true" />
              {s.label} <strong>{totals[s.key]}</strong>
            </li>
          ))}
        </ul>
        {/* Un tableau ignore la largeur de 1 px : c'est son conteneur qui est caché. */}
        <div className="visuellement-cache">
          <table>
            <caption>Décisions par jour</caption>
            <thead>
              <tr>
                <th scope="col">Jour</th>
                {SERIES.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.startMs}>
                  <th scope="row">{DAY_LONG.format(new Date(day.startMs))}</th>
                  <td>{day.auto}</td>
                  <td>{day.approved}</td>
                  <td>{day.blocked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figcaption>
    </figure>
  );
}
