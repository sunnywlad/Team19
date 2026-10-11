import type { ReactNode } from "react";
import { CAMPAGNE, STAGES, type Figure, type Passage } from "../data/campagne.ts";

/**
 * Résultats de la campagne de tests : des chiffres figés, recopiés du rapport
 * (src/data/campagne.ts). Rien ici n'est lu dans les services, et chaque carte
 * le dit par son étiquette. Les réserves du rapport ferment l'écran.
 */
function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="panneau" aria-labelledby={id}>
      <header className="panneau-entete">
        <h2 id={id}>{title}</h2>
        <span className="source source-simulation" title={`Chiffres figés du rapport de campagne du ${CAMPAGNE.date}, non lus en direct`}>
          campagne hors ligne
        </span>
      </header>
      {children}
    </section>
  );
}

function Figures({ items }: { items: readonly Figure[] }) {
  return (
    <dl className="compteurs">
      {items.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const STAGE_CLASSES = ["etape-porte", "etape-file", "etape-relais", "etape-contrat"] as const;

/** Une barre empilée : où les 500 attaques ont été arrêtées. Les nombres sont aussi écrits en toutes lettres. */
function PassageBar({ passage }: { passage: Passage }) {
  const total = passage.stopped.reduce((sum, n) => sum + n, 0);
  let x = 0;
  return (
    <div className="campagne-passage" data-testid="campagne-passage">
      <p className="campagne-passage-titre">
        <strong>{passage.label}</strong> <span className="campagne-zero">0 € sorti à tort</span>
      </p>
      <svg className="campagne-barre" viewBox={`0 0 ${total} 28`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {passage.stopped.map((n, i) => {
          const rect = <rect key={STAGES[i]} className={STAGE_CLASSES[i]} x={x} y={0} width={n} height={28} />;
          x += n;
          return rect;
        })}
      </svg>
      <p className="discret">{passage.stopped.map((n, i) => `${STAGES[i]} ${n}`).join(" · ")}</p>
    </div>
  );
}

const DECISION_CLASSES = { Acceptée: "decision-accepte", Refusée: "decision-refuse", "Revue humaine": "decision-humain" } as const;

export function CampagneView() {
  const c = CAMPAGNE;
  return (
    <>
      <p className="campagne-avis" role="note" data-testid="campagne-avis">
        Simulation hors ligne du {c.date}. Ces chiffres sont figés et recopiés du rapport de campagne : cet écran ne les lit pas dans les
        services, contrairement aux autres. Données synthétiques, aucun fonds réel.
      </p>

      <Card id="titre-camp-resultat" title="Un trimestre de trésorerie attaqué 500 fois">
        <div className="campagne-tete">
          <p className="campagne-chiffre">
            <strong data-testid="campagne-sorti">{c.headline.value}</strong>
            <span>{c.headline.label}</span>
          </p>
          <Figures items={c.keys} />
        </div>
        <p className="discret">{c.scenario}</p>
      </Card>

      <Card id="titre-camp-profondeur" title="Aveugler le filtre ne change pas le résultat">
        {c.passages.map((p) => (
          <PassageBar key={p.label} passage={p} />
        ))}
        <ul className="campagne-legende" aria-hidden="true">
          {STAGES.map((stage, i) => (
            <li key={stage}>
              <span className={`campagne-puce ${STAGE_CLASSES[i]}`} /> {stage}
            </li>
          ))}
        </ul>
        <p className="discret">Nombre d'attaques arrêtées à chaque étape, sur 500. {c.passagesNote}</p>
      </Card>

      <Card id="titre-camp-familles" title="Les 18 familles d'attaque">
        <div className="defilement">
          <table>
            <thead>
              <tr>
                <th scope="col">Attaque</th>
                <th scope="col">Tentatives</th>
                <th scope="col">Montant visé</th>
                <th scope="col">Arrêtée par</th>
              </tr>
            </thead>
            <tbody>
              {c.families.map((f) => (
                <tr key={f.attack} data-testid="campagne-famille">
                  <th scope="row">{f.attack}</th>
                  <td data-label="Tentatives" className="duree">
                    {f.attempts}
                  </td>
                  <td data-label="Montant visé" className="duree">
                    {f.targeted}
                  </td>
                  <td data-label="Arrêtée par">{f.stoppedBy}</td>
                </tr>
              ))}
              <tr className="campagne-total">
                <th scope="row">Total</th>
                <td data-label="Tentatives" className="duree">
                  {c.familiesTotal.attempts}
                </td>
                <td data-label="Montant visé" className="duree">
                  {c.familiesTotal.targeted}
                </td>
                <td data-label="Arrêtée par">{c.familiesTotal.outcome}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card id="titre-camp-residuel" title="Le cas où de l'argent sort">
        <p>{c.residual.lead}</p>
        <dl className="compteurs campagne-residuel">
          <div className="campagne-perte">
            <dt>{c.residual.lost.label}</dt>
            <dd data-testid="campagne-perte">{c.residual.lost.value}</dd>
          </div>
          <div className="campagne-arrete">
            <dt>{c.residual.stopped.label}</dt>
            <dd>{c.residual.stopped.value}</dd>
          </div>
        </dl>
        <p className="discret">{c.residual.note}</p>
      </Card>

      <Card id="titre-camp-activite" title="Activité normale">
        <Figures items={c.activity} />
        {c.activityNotes.map((note) => (
          <p key={note} className="discret">
            {note}
          </p>
        ))}
      </Card>

      <Card id="titre-camp-pannes" title="Une panne vaut refus, jamais autorisation">
        <div className="defilement">
          <table>
            <thead>
              <tr>
                <th scope="col">Panne simulée</th>
                <th scope="col">Demandes en vol</th>
                <th scope="col">Pendant la panne</th>
                <th scope="col">Après la reprise</th>
              </tr>
            </thead>
            <tbody>
              {c.outages.map((o) => (
                <tr key={o.outage}>
                  <th scope="row">{o.outage}</th>
                  <td data-label="Demandes en vol" className="duree">
                    {o.inFlight}
                  </td>
                  <td data-label="Pendant la panne">{o.during}</td>
                  <td data-label="Après la reprise">{o.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="discret">{c.journal}</p>
      </Card>

      <Card id="titre-camp-chaine" title="Sur la chaîne de test">
        <p>{c.chain.lead}</p>
        <Figures items={c.chain.figures} />
        <div className="defilement">
          <table>
            <thead>
              <tr>
                <th scope="col">Demande</th>
                <th scope="col">Ce qui est envoyé</th>
                <th scope="col">Votes</th>
                <th scope="col">Décision</th>
              </tr>
            </thead>
            <tbody>
              {c.chain.requests.map((r) => (
                <tr key={r.ids} data-testid="campagne-demande">
                  <th scope="row">{r.ids}</th>
                  <td data-label="Ce qui est envoyé">{r.sent}</td>
                  <td data-label="Votes">{r.votes}</td>
                  <td data-label="Décision">
                    <span className={`decision ${DECISION_CLASSES[r.decision]}`}>{r.decision}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card id="titre-camp-portee" title="Ce que ces chiffres ne disent pas">
        <ul className="campagne-portee" data-testid="campagne-portee">
          {c.limits.map(([head, body]) => (
            <li key={head}>
              <strong>{head}</strong> {body}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
