import type { JournalVerification } from "../api/types.ts";
import { ClockTag, OpaqueId } from "../components/atoms.tsx";
import { Panel } from "../components/Panel.tsx";
import { latestIncidents } from "../domain/activity.ts";
import { formatDateTime, formatTime } from "../lib/format.ts";
import type { ViewProps } from "./shared.ts";

const DEFECTS: Record<string, string> = {
  SEQ_MISMATCH: "rang inattendu : une entrée a été retirée ou déplacée",
  PREV_MISMATCH: "empreinte précédente différente",
  HASH_MISMATCH: "empreinte recalculée différente : une entrée a été modifiée",
  FORMAT: "entrée non conforme au schéma",
  HEAD_MISMATCH: "tête différente de la référence",
};

/** Résultat de la dernière vérification. Sans vérification : « non vérifié », jamais autre chose. */
function Verdict({ state }: { state: JournalVerification }) {
  const v = state.verification;
  if (v === null) {
    return (
      <p className="verdict verdict-inconnu" data-testid="verdict">
        <strong>Non vérifié</strong> : aucune vérification du journal n'a été rapportée.
      </p>
    );
  }
  const where = v.defect_seq === null ? "" : ` à l'entrée ${v.defect_seq}`;
  const defect = v.defect === null ? "" : ` : ${DEFECTS[v.defect] ?? "défaut inconnu"}${where}`;
  const behind = state.head !== null && v.head_seq !== null && state.head.seq > v.head_seq ? state.head.seq - v.head_seq : 0;
  return (
    <>
      {v.result === "OK" ? (
        <p className="verdict verdict-ok" data-testid="verdict">
          <strong>Chaîne intègre</strong> sur {v.entries} entrée{v.entries > 1 ? "s" : ""}
          {v.expected_head_checked
            ? ", et tête conforme à la référence conservée hors du journal."
            : ". Vérifiée sans tête de référence : la suppression des dernières entrées ne serait pas vue."}
        </p>
      ) : (
        <p className="verdict verdict-ko" data-testid="verdict">
          <strong>
            {v.result === "BROKEN" ? "Chaîne rompue" : v.result === "FORMAT" ? "Journal illisible" : "Tête différente de la référence"}
          </strong>
          {defect}.
        </p>
      )}
      <p className="discret" data-testid="verification-date">
        Dernière vérification : {formatDateTime(v.verified_at_ms)} <ClockTag clock="journal" />
        {v.head_seq !== null && <> · jusqu'à l'entrée {v.head_seq}</>}
      </p>
      {behind > 0 && (
        <p className="alerte-ligne" role="status" data-testid="non-verifiees">
          {behind} entrée{behind > 1 ? "s" : ""} écrite{behind > 1 ? "s" : ""} depuis cette vérification : non vérifiée{behind > 1 ? "s" : ""}.
        </p>
      )}
    </>
  );
}

export function JournalView({ view }: { view: ViewProps }) {
  const { response, sources, now } = view;
  return (
    <>
      <Panel title="Journal chaîné" id="titre-journal" source={sources.response} snapshot={response} now={now}>
        {(data) => {
          const { head } = data.verification;
          const byseq = new Map(data.journal.map((e) => [e.seq, e.hash]));
          return (
            <>
              <h3>Empreinte de tête</h3>
              {head === null ? (
                <p className="indisponible" data-testid="tete">
                  non disponible
                </p>
              ) : (
                <p data-testid="tete">
                  Entrée {head.seq} · <code className="empreinte">{head.hash}</code>
                </p>
              )}

              <h3>Vérification</h3>
              <Verdict state={data.verification} />
              <p className="limite" data-testid="limite">
                Limite : la suppression des dernières entrées n'est détectée que si l'empreinte de tête est conservée ailleurs. Une chaîne
                tronquée ou entièrement recalculée reste cohérente ; seule une tête de référence gardée hors du journal (rapport d'incident,
                ancrage) le révèle.
              </p>

              <h3>Têtes conservées dans les rapports d'incident</h3>
              {data.incidents.length === 0 ? (
                <p className="vide">Aucun rapport : aucune tête de référence.</p>
              ) : (
                <ul className="hors-contrat">
                  {latestIncidents(data.incidents).map(({ report }) => {
                    const current = byseq.get(report.journal_head.seq);
                    const status =
                      head !== null && report.journal_head.seq > head.seq
                        ? "le journal est plus court que cette tête : des entrées manquent"
                        : current === undefined
                          ? "entrée hors de la fenêtre lue : non comparée"
                          : current === report.journal_head.hash
                            ? "concorde avec le journal"
                            : "diffère du journal : entrée modifiée ou chaîne recalculée";
                    return (
                      <li key={report.incident_id} data-testid="tete-rapport">
                        Rapport <OpaqueId value={report.incident_id} /> : entrée {report.journal_head.seq} ·{" "}
                        <OpaqueId value={report.journal_head.hash} /> · <span className="synthese">{status}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          );
        }}
      </Panel>

      <Panel title="Dernières entrées" id="titre-entrees" source={sources.response} snapshot={response} now={now}>
        {(data) =>
          data.journal.length === 0 ? (
            <p className="vide">Journal vide.</p>
          ) : (
            <div className="defilement" role="region" aria-label="Dernières entrées du journal" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Rang</th>
                    <th scope="col">Heure d'écriture</th>
                    <th scope="col">Type</th>
                    <th scope="col">Composant</th>
                    <th scope="col">Demande</th>
                    <th scope="col">Agent authentifié</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.journal]
                    .sort((a, b) => b.seq - a.seq)
                    .slice(0, 20)
                    .map((entry) => (
                      <tr key={entry.seq} data-testid="entree">
                        <td data-label="Rang">{entry.seq}</td>
                        <td data-label="Heure d'écriture">{formatTime(entry.ts_ms)}</td>
                        <td data-label="Type">
                          <code>{entry.type}</code>
                        </td>
                        <td data-label="Composant">
                          <code>{entry.component}</code>
                        </td>
                        <td data-label="Demande">
                          <OpaqueId value={entry.request_id} />
                        </td>
                        <td data-label="Agent authentifié">
                          <OpaqueId value={entry.agent_id} missing="aucun" />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Panel>
    </>
  );
}
