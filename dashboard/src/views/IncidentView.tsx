import { useState } from "react";
import type { IncidentItem, IncidentReport } from "../api/types.ts";
import { Nom } from "../components/Affichage.tsx";
import { Amount, ClockTag, DecisionBadge, OpaqueId, SourceTag, Untrusted, Vide } from "../components/atoms.tsx";
import { DelaysNote, DelaysTable } from "../components/DelaysPanel.tsx";
import { Icon } from "../components/icons.tsx";
import { Panel } from "../components/Panel.tsx";
import { PauseBadge } from "../components/PauseBadge.tsx";
import { Pastille, SeverityPill } from "../components/pills.tsx";
import { Counter } from "../components/Rolling.tsx";
import { chainPausedAgents, latestIncidents } from "../domain/activity.ts";
import { chainPauseTimestamp, computeDelays, detectionClock, type Delay } from "../domain/delays.ts";
import {
  ACTION_TAKEN_LABELS,
  HUMAN_DECISION_LABELS,
  MANDATE_LABELS,
  ROLE_LABELS,
  TRIGGER_LABELS,
  detectorCodeLabel,
} from "../domain/labels.ts";
import { readDecision } from "../domain/reasons.ts";
import { useArrival } from "../hooks/useArrival.ts";
import { formatDateTime, formatDurationMs, formatDurationS, formatTime } from "../lib/format.ts";
import { EXCERPT_MAX } from "../lib/safeText.ts";
import { sameWorld, vaultFed, type ViewProps } from "./shared.ts";

/** Les trois temps de la réponse, en tuiles. Chaque tuile nomme la mesure qu'elle montre et son horloge. */
const TILES = [
  { key: "detection", title: "Détection", main: "arrivee-detection", other: "arrivee-observation" },
  { key: "pause", title: "Mise en pause", main: "detection-pause", other: "observation-pause" },
  { key: "alerte", title: "Alerte", main: "detection-alerte", other: "observation-alerte" },
] as const;

function DelayTiles({ delays }: { delays: Delay[] }) {
  const find = (key: string): Delay | undefined => delays.find((d) => d.key === key);
  return (
    <ul className="chiffres3" aria-label="Temps de la réponse" data-testid="tuiles-delais">
      {TILES.map((tile) => {
        // La mesure de la spec si elle tient sur une seule horloge ; sinon celle de la même attaque qui y tient.
        const main = find(tile.main);
        const other = find(tile.other);
        const shown = main && main.value !== null ? main : other && other.value !== null ? other : main;
        return (
          <li key={tile.key} data-tuile={tile.key}>
            <span>{tile.title}</span>
            <b>
              {shown && shown.value !== null && shown.clock !== null
                ? shown.clock === "bloc"
                  ? formatDurationS(shown.value)
                  : formatDurationMs(shown.value)
                : "non mesuré"}
            </b>
            <span>
              {shown ? shown.label : "mesure absente"}
              {shown && shown.clock !== null && (
                <>
                  {" "}
                  <ClockTag clock={shown.clock} />
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Ce qui s'est passé, en une phrase, à partir des seuls champs du rapport. */
function summaryOf(report: IncidentReport): string {
  const score = report.detector.score;
  if (report.contract === null) {
    return `La demande a été arrêtée à la porte d'entrée${score === null ? "" : ` (score ${score} pour un seuil de ${report.detector.threshold})`}, avant toute signature : le contrat n'a pas été atteint.`;
  }
  const read = readDecision({ ...report.contract, effective_decision: report.contract.decision });
  return `La demande a passé la porte d'entrée${score === null ? "" : ` (score ${score} pour un seuil de ${report.detector.threshold})`} ; le contrat l'a ${
    read.kind === "refuse" ? `refusée : ${read.reasonLabel}` : read.kind === "humain" ? "renvoyée à un humain" : "acceptée"
  }.`;
}

/** Réponse automatique, sur l'horloge du journal : chaque action datée depuis l'arrivée de la demande. */
function ResponseTimeline({ report }: { report: IncidentReport }) {
  const t = report.timestamps;
  const since = (ms: number): string => (ms >= t.received_at_ms ? `+${formatDurationMs(ms - t.received_at_ms)}` : formatTime(ms));
  const contractDetection = detectionClock(report) === "bloc";
  return (
    <ol className="chrono" data-testid="actions">
      <li>
        <span className="pt" aria-hidden="true" />
        <span>
          Demande reçue de <Nom id={report.authority_chain.agent_id} genre="agent" />
        </span>
        <time>
          {formatTime(t.received_at_ms)} <ClockTag clock="journal" />
        </time>
      </li>
      <li>
        <span className="pt pt-refus" aria-hidden="true" />
        <span>{contractDetection ? "Refus du contrat lu dans l'événement Decision" : "Détectée à la porte d'entrée"}</span>
        <time>
          {contractDetection ? (
            <>
              {formatTime(t.detected_at_ms)} <ClockTag clock="bloc" />
            </>
          ) : (
            since(t.detected_at_ms)
          )}
        </time>
      </li>
      {report.automatic_actions.map((a) => (
        <li key={`${a.action}:${a.journal_seq}`}>
          <span className={a.action === "REPORT" ? "pt pt-ok" : "pt pt-attente"} aria-hidden="true" />
          <span>
            <span className="synthese">{ACTION_TAKEN_LABELS[a.action]}</span> <span className="discret">· entrée {a.journal_seq} du journal</span>
          </span>
          <time>{since(a.at_ms)}</time>
        </li>
      ))}
    </ol>
  );
}

type DetailProps = { item: IncidentItem; chainPause: number | null; fakeVault: boolean; paused: string[] };

function Detail({ item, chainPause, fakeVault, paused }: DetailProps) {
  const { report } = item;
  const contract = report.contract ? readDecision({ ...report.contract, effective_decision: report.contract.decision }) : null;
  const open = report.human_decision === null;
  return (
    <div className="detail" data-testid="rapport">
      <header className="detail-entete">
        <p className="discret">
          Incident <OpaqueId value={report.incident_id} /> · rapport du {formatDateTime(report.generated_at_ms)} <ClockTag clock="journal" />
        </p>
        <h2>{TRIGGER_LABELS[report.trigger]}</h2>
        <p className="pastilles">
          <SeverityPill trigger={report.trigger} />{" "}
          <Pastille ton={open ? "attente" : "ok"}>{open ? "Ouvert" : "Qualifié par un humain"}</Pastille>
          <strong className="visuellement-cache" data-testid="etat-incident">
            {open ? "ouvert" : "qualifié par un humain"}
          </strong>
        </p>
        <p data-testid="resume">{summaryOf(report)}</p>
      </header>

      <dl className="chiffres3">
        <div>
          <dt>Montant exposé (inscrit au contrat)</dt>
          <dd data-testid="expose">
            <Amount wei={report.amounts.exposed_wei} missing="inconnu du contrat" />
          </dd>
        </div>
        <div>
          <dt>Montant effectivement sorti</dt>
          <dd data-testid="sorti" className="sorti">
            <Amount wei={report.amounts.out_wei} />
          </dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>
            <Nom id={report.authority_chain.agent_id} genre="agent" withId />
            {paused.length > 0 && (
              <>
                {" "}
                <PauseBadge scopes={paused} />
              </>
            )}
          </dd>
        </div>
      </dl>

      <section>
        <h3 className="titre-section">Élément signalé</h3>
        {item.quarantine_excerpt === null ? (
          <p className="vide">Aucun extrait fourni.</p>
        ) : (
          <figure className="extrait" data-testid="extrait">
            <figcaption>Contenu non fiable · texte reçu d'un tiers, jamais interprété · {EXCERPT_MAX} caractères au plus</figcaption>
            <p>
              <Untrusted text={item.quarantine_excerpt} max={EXCERPT_MAX} />
            </p>
          </figure>
        )}
      </section>

      <section>
        <h3 className="titre-section">Réponse automatique</h3>
        <ResponseTimeline report={report} />
        <p className="discret">Les actions automatiques ne font que bloquer : aucune ne déplace de fonds. Une pause se lève par un humain habilité, hors de cette console.</p>
      </section>

      <section>
        <h3 className="titre-section">Temps de la réponse</h3>
        <DelayTiles delays={computeDelays(report, chainPause)} />
      </section>

      <section>
        <h3 className="titre-section">Porte d'entrée et contrat</h3>
        <dl className="kv">
          <dt>Score du détecteur</dt>
          <dd data-testid="score">
            {report.detector.score === null ? <span className="indisponible">le détecteur n'a pas tourné</span> : report.detector.score} pour un seuil de{" "}
            {report.detector.threshold}
          </dd>
          <dt>Codes raison</dt>
          <dd data-testid="codes">
            {report.detector.reason_codes.length === 0
              ? "aucun : la demande a passé la porte d'entrée"
              : report.detector.reason_codes.map((code) => `${detectorCodeLabel(code)} (${code})`).join(", ")}
          </dd>
          <dt>Décision du contrat</dt>
          <dd data-testid="decision-contrat">
            {report.contract === null || contract === null ? (
              "Contrat non atteint : la demande a été arrêtée avant lui."
            ) : (
              <>
                <DecisionBadge kind={contract.kind} /> <span className="synthese">{contract.summary}</span>{" "}
                <span className="discret">
                  · bloc {report.contract.block_number} ({formatTime(report.contract.block_timestamp * 1000)}) · transaction{" "}
                  <OpaqueId value={report.contract.tx_hash} />
                </span>
              </>
            )}
            {fakeVault && (
              <span data-testid="decision-contrat-simulee" className="bloc">
                <SourceTag source="faux-coffre" /> faux coffre : aucun contrat n'a jugé
              </span>
            )}
          </dd>
          <dt>Décision humaine</dt>
          <dd data-testid="decision-humaine">
            {report.human_decision === null ? (
              "Aucune pour l'instant : l'incident reste ouvert. Une pause ne se lève que par un humain habilité."
            ) : (
              <>
                {HUMAN_DECISION_LABELS[report.human_decision.decision] ?? "décision inconnue"} ·{" "}
                {ROLE_LABELS[report.human_decision.author_role] ?? "rôle inconnu"} <OpaqueId value={report.human_decision.author_id} /> ·{" "}
                {formatDateTime(report.human_decision.at_ms)}
              </>
            )}
          </dd>
        </dl>
      </section>

      <details className="replie">
        <summary>Délais détaillés et chaîne d'autorité</summary>
        <DelaysTable report={report} chainPause={chainPause} />
        <DelaysNote />
        <Authority report={report} />
      </details>
    </div>
  );
}

function Authority({ report }: { report: IncidentReport }) {
  return (
    <dl className="kv">
      <dt>Demandes</dt>
      <dd>
        {report.request_ids.map((id) => (
          <span key={id} className="jeton">
            <OpaqueId value={id} />{" "}
          </span>
        ))}
      </dd>
      <dt>Agent d'origine</dt>
      <dd>
        <Nom id={report.authority_chain.agent_id} genre="agent" withId />
      </dd>
      <dt>Mandat de l'agent</dt>
      <dd>
        {report.authority_chain.agent_mandate.length === 0
          ? "aucun"
          : report.authority_chain.agent_mandate.map((m) => MANDATE_LABELS[m] ?? "inconnu").join(", ")}
      </dd>
      <dt>Client</dt>
      <dd>
        <Nom id={report.authority_chain.client_id} genre="client" withId />
      </dd>
      <dt>Signataire du client</dt>
      <dd>
        <OpaqueId value={report.authority_chain.client_signer} missing="demande jamais signée" />
      </dd>
      <dt>Transaction du relais</dt>
      <dd>
        <OpaqueId value={report.authority_chain.relay_tx_hash} missing="demande jamais soumise" />
      </dd>
      <dt>Empreinte du journal</dt>
      <dd>
        entrée {report.journal_head.seq} · <OpaqueId value={report.journal_head.hash} />
      </dd>
    </dl>
  );
}

/**
 * Rapport d'incident, mis en page comme un document à lire ou à imprimer avec
 * le navigateur. Il reprend les champs du rapport de specs/05 et rien d'autre :
 * aucune signature, aucun export.
 */
function ReportDocument({ item, chainPause }: { item: IncidentItem; chainPause: number | null }) {
  const { report } = item;
  return (
    <article className="feuille-doc" data-testid="rapport-document" aria-labelledby="titre-rapport-doc">
      <header className="entete-doc">
        <div>
          <p className="discret">Rapport d'incident · version {report.report_version}</p>
          <h2 id="titre-rapport-doc">{TRIGGER_LABELS[report.trigger]}</h2>
        </div>
        <p className="discret">
          Incident <OpaqueId value={report.incident_id} />
          <br />
          Généré le {formatDateTime(report.generated_at_ms)} <ClockTag clock="journal" />
        </p>
      </header>
      <section>
        <h3>Résumé</h3>
        <p>{summaryOf(report)}</p>
      </section>
      <section>
        <h3>Montants</h3>
        <dl className="kv">
          <dt>Exposé</dt>
          <dd>
            <Amount wei={report.amounts.exposed_wei} missing="inconnu du contrat" />
          </dd>
          <dt>Sorti</dt>
          <dd>
            <Amount wei={report.amounts.out_wei} />
          </dd>
        </dl>
      </section>
      <section>
        <h3>Chronologie</h3>
        <ResponseTimeline report={report} />
      </section>
      <section>
        <h3>Délais</h3>
        <DelaysTable report={report} chainPause={chainPause} />
        <DelaysNote />
      </section>
      <section>
        <h3>Chaîne d'autorité</h3>
        <Authority report={report} />
      </section>
      <section>
        <h3>Décision humaine</h3>
        <p>
          {report.human_decision === null
            ? "Aucune : l'incident est ouvert."
            : `${HUMAN_DECISION_LABELS[report.human_decision.decision] ?? "décision inconnue"}, ${formatDateTime(report.human_decision.at_ms)}.`}
        </p>
      </section>
      <footer className="sceau">
        <span>
          Empreinte du journal au moment du rapport : entrée {report.journal_head.seq} · <OpaqueId value={report.journal_head.hash} />
        </span>
        <span className="discret">Document affiché par la console, en lecture seule. Ni signé, ni exporté : la piste d'audit fait foi.</span>
      </footer>
    </article>
  );
}

export function IncidentView({ view }: { view: ViewProps }) {
  const { relay, response, sources, now } = view;
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"ouverts" | "qualifies">("ouverts");
  const [asDocument, setAsDocument] = useState(false);
  const linked = sameWorld(sources);
  // Un incident apparu depuis l'ouverture de la page. Les plus anciens d'abord pour useArrival.
  const known = response.data ? latestIncidents(response.data.incidents) : null;
  const arrival = useArrival<{ key: string }>([known ? [...known].reverse().map((i) => ({ key: i.report.incident_id })) : null]);
  return (
    <>
      <Panel title="Incidents" id="titre-incidents" source={sources.response} famille="response" snapshot={response} now={now} className="carte-plate">
        {(data) => {
          const incidents = latestIncidents(data.incidents);
          const opened = incidents.filter((i) => i.report.human_decision === null);
          const qualified = incidents.filter((i) => i.report.human_decision !== null);
          const missed = incidents.filter((i) => i.report.trigger === "CONTRACT_REFUSAL").length;
          const shown = tab === "ouverts" ? opened : qualified;
          const current = shown.find((i) => i.report.incident_id === selected) ?? shown[0];
          const pause =
            current && linked && relay.data && current.report.contract
              ? chainPauseTimestamp(relay.data.events, current.report.authority_chain.agent_id, current.report.contract.block_number)
              : null;
          // Agents en pause : hors chaîne (service de réponse), sur la chaîne (événements, seulement s'ils sont du même monde).
          const offchain = new Set(data.pausedAgents.filter((p) => p.scope === "OFFCHAIN").map((p) => p.agent_id));
          const onchain = new Set(linked && relay.data ? chainPausedAgents(relay.data.events).map((p) => p.agentId) : []);
          const scopesOf = (agent: string): string[] => [offchain.has(agent) ? "hors chaîne" : null, onchain.has(agent) ? "sur la chaîne" : null].filter((x) => x !== null);
          return (
            <>
              <div className="carte-outils">
                <dl className="compteurs compteurs-ligne">
                  <div>
                    <dt>Incidents ouverts</dt>
                    <dd data-testid="compteur-ouverts">
                      <Counter value={opened.length} />
                    </dd>
                  </div>
                  <div>
                    <dt>Passées la porte puis bloquées par le contrat</dt>
                    <dd data-testid="compteur-manquees">
                      <Counter value={missed} />
                    </dd>
                  </div>
                </dl>
                {current && (
                  <button type="button" className="btn" data-ui="affichage" aria-pressed={asDocument} onClick={() => setAsDocument(!asDocument)}>
                    <Icon name="document" />
                    {asDocument ? "Revenir au détail" : "Voir le rapport"}
                  </button>
                )}
              </div>
              {incidents.length === 0 ? (
                <Vide hint="Toute demande arrêtée par la porte d'entrée ou par le contrat apparaîtra ici, avec son rapport et la réponse déclenchée.">
                  Aucun incident.
                </Vide>
              ) : asDocument && current ? (
                <ReportDocument key={current.report.incident_id} item={current} chainPause={pause} />
              ) : (
                <div className="md">
                  <div className="carte">
                    <div className="onglets" role="tablist" aria-label="État des incidents">
                      {(
                        [
                          ["ouverts", "Ouverts", opened.length],
                          ["qualifies", "Qualifiés", qualified.length],
                        ] as const
                      ).map(([key, label, n]) => (
                        <button key={key} type="button" role="tab" data-ui="affichage" aria-selected={tab === key} onClick={() => setTab(key)}>
                          {label} <span className="n">{n}</span>
                        </button>
                      ))}
                    </div>
                    {shown.length === 0 ? (
                      <Vide className="carte-vide">{tab === "ouverts" ? "Aucun incident ouvert." : "Aucun incident qualifié par un humain."}</Vide>
                    ) : (
                      <ul className="liste-inc" aria-label="Choisir un incident">
                        {shown.map((i) => {
                          const id = i.report.incident_id;
                          const agent = i.report.authority_chain.agent_id;
                          const fresh = arrival !== null && arrival.item.key === id;
                          const scopes = scopesOf(agent);
                          return (
                            <li
                              // Nouvelle clé à l'arrivée : la carte rejoue son entrée, une fois.
                              key={fresh ? `${id}:${arrival.count}` : id}
                              className={fresh ? "carte-incident carte-arrivee" : "carte-incident"}
                              data-testid="carte-incident"
                              data-arrivee={fresh ? "true" : "false"}
                            >
                              <button type="button" className="inc" data-ui="navigation" aria-pressed={i === current} onClick={() => setSelected(id)}>
                                <span className="ligne1">
                                  <b>{TRIGGER_LABELS[i.report.trigger]}</b>
                                  <SeverityPill trigger={i.report.trigger} />
                                </span>
                                <span>
                                  <Nom id={agent} genre="agent" /> · {formatTime(i.report.generated_at_ms)}
                                </span>
                                {scopes.length > 0 && <PauseBadge scopes={scopes} />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  {/* Nouvelle clé à chaque incident choisi : le détail entre en fondu. */}
                  {current && (
                    <div className="carte">
                      <Detail
                        key={current.report.incident_id}
                        fakeVault={vaultFed(sources.relay, view.vaultOrigin) === "faux-coffre"}
                        item={current}
                        chainPause={pause}
                        paused={scopesOf(current.report.authority_chain.agent_id)}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          );
        }}
      </Panel>

      <div className="deux">
        <Panel title="Agents en pause, hors chaîne" id="titre-pauses" source={sources.response} famille="response" snapshot={response} now={now}>
          {(data) => {
            const offchain = data.pausedAgents.filter((p) => p.scope === "OFFCHAIN");
            return offchain.length === 0 ? (
              <p className="vide">Aucun agent en pause.</p>
            ) : (
              <ul className="hors-contrat">
                {offchain.map((p) => (
                  <li key={`${p.agent_id}:${p.paused_at_ms}`} data-testid="agent-en-pause">
                    <p>
                      <PauseBadge scopes={["hors chaîne"]} /> <Nom id={p.agent_id} genre="agent" withId /> en pause depuis {formatTime(p.paused_at_ms)}{" "}
                      <ClockTag clock="journal" />
                    </p>
                    <p className="discret">
                      incident <OpaqueId value={p.incident_id} />
                    </p>
                  </li>
                ))}
              </ul>
            );
          }}
        </Panel>
        <Panel title="Agents en pause, sur la chaîne" id="titre-pauses-chaine" source={vaultFed(sources.relay, view.vaultOrigin)} famille="relay" snapshot={relay} now={now}>
          {(data) => {
            const onchain = chainPausedAgents(data.events);
            return onchain.length === 0 ? (
              <p className="vide">Aucun agent en pause sur la chaîne.</p>
            ) : (
              <ul className="hors-contrat">
                {onchain.map((p) => (
                  <li key={p.agentId} data-testid="agent-en-pause-chaine">
                    <p>
                      <PauseBadge scopes={["sur la chaîne"]} /> <Nom id={p.agentId} genre="agent" withId /> en pause depuis le bloc {p.blockNumber} (
                      {formatTime(p.blockTimestamp * 1000)}) <ClockTag clock="bloc" />
                    </p>
                  </li>
                ))}
              </ul>
            );
          }}
        </Panel>
      </div>
    </>
  );
}
