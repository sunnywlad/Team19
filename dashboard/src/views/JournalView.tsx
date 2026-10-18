import { useState } from "react";
import type { JournalEntry, JournalVerification } from "../api/types.ts";
import { Nom } from "../components/Affichage.tsx";
import { ClockTag, OpaqueId } from "../components/atoms.tsx";
import { Icon } from "../components/icons.tsx";
import { Panel } from "../components/Panel.tsx";
import { latestIncidents } from "../domain/activity.ts";
import { formatDateTime } from "../lib/format.ts";
import type { ViewProps } from "./shared.ts";

/** Qui écrit l'entrée (specs/04) : un composant, jamais une personne nommée. */
const COMPONENTS: Record<JournalEntry["component"], string> = {
  GATEWAY: "Porte d'entrée",
  CLIENT_AI: "IA du client",
  QUEUE: "File",
  RELAY: "Relais",
  RESPONSE: "Service de réponse",
  HUMAN: "Humain",
};

/** Libellé lisible d'un type d'entrée ; le code reste affiché à côté. Type inconnu : le code seul. */
const TYPES: Record<string, string> = {
  REQUEST_RECEIVED: "Demande reçue",
  AUTH_REJECTED: "Rejetée à l'entrée",
  RATE_LIMITED: "Limite de débit dépassée",
  DETECTION: "Contrôle d'entrée",
  REQUEST_PARSED: "Demande lue",
  FORWARDED_TO_CLIENT_AI: "Transmise à l'IA du client",
  REQUEST_SIGNED: "Signée par l'IA du client",
  ENQUEUED: "Mise en file",
  SUBMITTED: "Soumise au contrat",
  QUEUE_EXPIRED: "Expirée en file",
  DECISION_OBSERVED: "Décision du contrat lue",
  QUARANTINED: "Document mis en quarantaine",
  AGENT_PAUSED: "Agent mis en pause",
  ALERT_SENT: "Alerte envoyée",
  INCIDENT_REPORT_GENERATED: "Rapport d'incident généré",
};

const FILTERS = [
  { key: "tout", label: "Tout", keep: (_e: JournalEntry) => true },
  { key: "entree", label: "Porte et agents", keep: (e: JournalEntry) => e.component === "GATEWAY" || e.component === "CLIENT_AI" },
  { key: "relais", label: "File et relais", keep: (e: JournalEntry) => e.component === "QUEUE" || e.component === "RELAY" },
  { key: "reponse", label: "Réponse et humains", keep: (e: JournalEntry) => e.component === "RESPONSE" || e.component === "HUMAN" },
] as const;

/** Entrées affichées au plus : les plus récentes. */
const SHOWN = 50;

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
        <Icon name="info" />
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
          <Icon name="lien" />
          <strong>Chaîne intègre</strong> sur {v.entries} entrée{v.entries > 1 ? "s" : ""}
          {v.expected_head_checked
            ? ", et tête conforme à la référence conservée hors du journal."
            : ". Vérifiée sans tête de référence : la suppression des dernières entrées ne serait pas vue."}
        </p>
      ) : (
        <p className="verdict verdict-ko" data-testid="verdict">
          <Icon name="incident" />
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
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("tout");
  return (
    <>
      <Panel title="Journal chaîné" id="titre-journal" source={sources.response} famille="response" snapshot={response} now={now}>
        {(data) => {
          const { head } = data.verification;
          const byseq = new Map(data.journal.map((e) => [e.seq, e.hash]));
          return (
            <>
              <div className="verification">
                <Verdict state={data.verification} />
              </div>
              <dl className="kv">
                <dt>Empreinte de tête</dt>
                {head === null ? (
                  <dd className="indisponible" data-testid="tete">
                    non disponible
                  </dd>
                ) : (
                  <dd data-testid="tete">
                    Entrée {head.seq} · <code className="empreinte">{head.hash}</code>
                  </dd>
                )}
              </dl>
              <p className="limite" data-testid="limite">
                Limite : la suppression des dernières entrées n'est détectée que si l'empreinte de tête est conservée ailleurs. Une chaîne
                tronquée ou entièrement recalculée reste cohérente ; seule une tête de référence gardée hors du journal (rapport d'incident,
                ancrage) le révèle.
              </p>

              <h3 className="titre-section">Têtes conservées dans les rapports d'incident</h3>
              {data.incidents.length === 0 ? (
                <p className="vide">Aucun rapport : aucune tête de référence.</p>
              ) : (
                <ul className="hors-contrat hors-contrat-encart">
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
                        <p>
                          Rapport <OpaqueId value={report.incident_id} /> : entrée {report.journal_head.seq} ·{" "}
                          <OpaqueId value={report.journal_head.hash} /> · <span className="synthese">{status}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          );
        }}
      </Panel>

      <Panel title="Entrées" id="titre-entrees" source={sources.response} famille="response" snapshot={response} now={now} className="carte-liste">
        {(data) => {
          const keep = FILTERS.find((f) => f.key === filter)?.keep ?? (() => true);
          const rows = [...data.journal]
            .sort((a, b) => b.seq - a.seq)
            .filter(keep)
            .slice(0, SHOWN);
          return (
            <>
              <div className="carte-outils carte-outils-bord">
                <p className="discret">
                  {data.journal.length} entrée{data.journal.length > 1 ? "s" : ""} lue{data.journal.length > 1 ? "s" : ""}, les {SHOWN} plus récentes
                  au plus. Heure d'écriture <ClockTag clock="journal" />
                </p>
                <div className="segment" role="group" aria-label="Filtrer par composant">
                  {FILTERS.map((f) => (
                    <button key={f.key} type="button" data-ui="affichage" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {data.journal.length === 0 ? (
                <p className="vide carte-vide">Journal vide.</p>
              ) : rows.length === 0 ? (
                <p className="vide carte-vide">Aucune entrée de ce composant.</p>
              ) : (
                <div className="defilement" role="region" aria-label="Dernières entrées du journal" tabIndex={0}>
                  <table className="tableau">
                    <thead>
                      <tr>
                        <th scope="col">Rang</th>
                        <th scope="col">Date et heure</th>
                        <th scope="col">Écrit par</th>
                        <th scope="col">Événement</th>
                        <th scope="col">Demande</th>
                        <th scope="col">Agent authentifié</th>
                        <th scope="col">Empreinte</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((entry) => (
                        <tr key={entry.seq} data-testid="entree">
                          <td data-label="Rang">{entry.seq}</td>
                          <td data-label="Date et heure" className="mono">
                            {formatDateTime(entry.ts_ms)}
                          </td>
                          <td data-label="Écrit par">{COMPONENTS[entry.component]}</td>
                          <td data-label="Événement">
                            <span className="cellule">
                              <b>{TYPES[entry.type] ?? entry.type}</b> <code>{entry.type}</code>
                            </span>
                          </td>
                          <td data-label="Demande">
                            <OpaqueId value={entry.request_id} />
                          </td>
                          <td data-label="Agent authentifié">
                            <Nom id={entry.agent_id} genre="agent" missing="aucun" />
                          </td>
                          <td data-label="Empreinte">
                            <OpaqueId value={entry.hash} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        }}
      </Panel>
    </>
  );
}
