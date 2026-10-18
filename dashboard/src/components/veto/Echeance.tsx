import { CASES, deadlineView, formatHoursMinutes, formatWindow } from "../../domain/echeance.ts";
import { formatDayTime, formatWeekdayTime } from "../../lib/format.ts";
import { Icon } from "./glyphs.tsx";

type Props = {
  /** Échéance inscrite dans HoldPlaced, en secondes sur l'horloge des blocs. null : non lue. */
  deadline: number | null;
  /** Bloc de la décision 1, en secondes. */
  decidedAt: number;
  /** Horloge locale du navigateur, en millisecondes. */
  now: number;
  /** Heure d'écriture au journal de l'alerte à l'approbateur, si l'API la fournit. Sinon la ligne n'existe pas. */
  notifiedAtMs?: number | null;
  /** Jauge et temps restant seuls, pour une liste. */
  compact?: boolean;
};

/**
 * Jusqu'à quand un humain peut trancher : temps restant en heures et minutes,
 * date écrite, 24 cases (une case = 1/24 du délai) et la règle « sans signature :
 * refusé ». Trois états, chacun dit en mots : normal, proche (dernier quart),
 * échue. Rien ne bouge à la seconde pour un délai réel (domain/echeance.ts,
 * displayStep), et rien n'est animé : le mouvement est réservé aux faits.
 */
export function Echeance({ deadline, decidedAt, now, notifiedAtMs = null, compact = false }: Props) {
  const view = deadlineView(deadline, decidedAt, Math.floor(now / 1000));
  if (view === null || deadline === null) {
    return (
      <div className="echeance echeance-absente" data-testid="echeance" data-etat="non-disponible">
        <p className="echeance-temps" data-testid="echeance-temps">
          <span className="indisponible">Échéance non disponible</span>
        </p>
        {!compact && (
          <p className="echeance-phrase">
            Sans signature avant l'échéance : <strong>refusé</strong>.
          </p>
        )}
      </div>
    );
  }
  const { state, remainingS, casesOn, windowS } = view;
  const expired = state === "echue";
  const time = expired ? "Échéance dépassée" : formatHoursMinutes(remainingS);
  const shortWindow = windowS < 3600;
  const cases = Array.from({ length: CASES }, (_, i) => (expired ? "echue" : i < CASES - casesOn ? "ecoule" : "on"));
  return (
    <div className={`echeance echeance-${state}${compact ? " echeance-compacte" : ""}`} data-testid="echeance" data-etat={state} data-cases={String(casesOn)}>
      <div className="echeance-tete">
        <span className="echeance-temps" data-testid="echeance-temps">
          {time}
        </span>
        <span className="echeance-legende">
          <strong>Échéance {formatDayTime(deadline * 1000)}</strong>
          <br />
          {expired ? "plus aucune approbation possible" : `restantes · délai de ${formatWindow(windowS)}`}
          {state === "proche" && (
            <>
              {" · "}
              <strong className="echeance-alerte" data-testid="echeance-proche">
                Échéance proche
              </strong>
            </>
          )}
        </span>
      </div>
      <div
        className="segments"
        role="img"
        aria-label={`${expired ? "Échéance dépassée" : `${time} restantes`} ; ${CASES} cases, une case vaut 1/${CASES} du délai`}
      >
        {cases.map((kind, i) => (
          <i key={i} className={kind} />
        ))}
      </div>
      {!compact && (
        <>
          <div className="echeance-bornes" aria-hidden="true">
            <span>{formatWeekdayTime(decidedAt * 1000, shortWindow)}</span>
            <span>{formatWeekdayTime(deadline * 1000, shortWindow)}</span>
          </div>
          <p className="echeance-phrase" data-testid="echeance-phrase">
            {expired ? (
              <>
                Échéance dépassée : sans réponse humaine, la demande est <strong>refusée</strong> (APPROVAL_TIMEOUT). Rien n'est parti. Le montant
                reste bloqué tant que l'expiration n'est pas constatée sur la chaîne.
              </>
            ) : (
              <>
                Sans signature avant l'échéance : <strong>refusé</strong>.
              </>
            )}
          </p>
          <ol className="jalons" data-testid="echeance-jalons">
            <li className="jalon jalon-fait">
              <Icon name="coche" small />
              <span>Mise en attente par le contrat</span>
              <span className="jalon-date">{formatDayTime(decidedAt * 1000)}</span>
            </li>
            {notifiedAtMs !== null && (
              <li className="jalon jalon-fait" data-testid="jalon-alerte">
                <Icon name="coche" small />
                <span>Alerte à l'approbateur écrite au journal</span>
                <span className="jalon-date">{formatDayTime(notifiedAtMs)}</span>
              </li>
            )}
            <li className={expired ? "jalon jalon-fin" : "jalon jalon-attente"}>
              <Icon name={expired ? "croix" : "sablier"} small />
              <span>Sans signature : refusé (APPROVAL_TIMEOUT)</span>
              <span className="jalon-date">{formatDayTime(deadline * 1000)}</span>
            </li>
          </ol>
        </>
      )}
    </div>
  );
}
