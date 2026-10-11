import { useState } from "react";
import type { IncidentItem } from "../api/types.ts";
import { ClockTag, Amount, DecisionBadge, OpaqueId, SourceTag, Untrusted } from "../components/atoms.tsx";
import { DelaysNote, DelaysTable } from "../components/DelaysPanel.tsx";
import { Panel } from "../components/Panel.tsx";
import { Counter } from "../components/Rolling.tsx";
import { chainPausedAgents, latestIncidents } from "../domain/activity.ts";
import { useArrival } from "../hooks/useArrival.ts";
import { PauseBadge } from "../components/PauseBadge.tsx";
import { chainPauseTimestamp, computeDelays, type Delay } from "../domain/delays.ts";
import {
  ACTION_TAKEN_LABELS,
  HUMAN_DECISION_LABELS,
  MANDATE_LABELS,
  ROLE_LABELS,
  TRIGGER_LABELS,
  detectorCodeLabel,
} from "../domain/labels.ts";
import { readDecision } from "../domain/reasons.ts";
import { formatDateTime, formatDurationMs, formatDurationS, formatTime } from "../lib/format.ts";
import { EXCERPT_MAX } from "../lib/safeText.ts";
import { sameWorld, vaultFed, type ViewProps } from "./shared.ts";

/** Les trois temps de la réponse, en tuiles. Chaque tuile nomme la mesure qu'elle montre et son horloge. */
const TILES = [
  { key: "detection", title: "Détection", main: "arrivee-detection", other: "arrivee-observation", icon: <path d="M9 3.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M13 13l4 4" /> },
  { key: "pause", title: "Mise en pause", main: "detection-pause", other: "observation-pause", icon: <path d="M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14M8 7.5v5M12 7.5v5" /> },
  { key: "alerte", title: "Alerte", main: "detection-alerte", other: "observation-alerte", icon: <path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8.5 17.5h3" /> },
] as const;

function DelayTiles({ delays }: { delays: Delay[] }) {
  const find = (key: string): Delay | undefined => delays.find((d) => d.key === key);
  return (
    <ul className="tuiles" aria-label="Temps de la réponse" data-testid="tuiles-delais">
      {TILES.map((tile) => {
        // La mesure de la spec si elle tient sur une seule horloge ; sinon celle de la même attaque qui y tient.
        const main = find(tile.main);
        const other = find(tile.other);
        const shown = main && main.value !== null ? main : other && other.value !== null ? other : main;
        const measured = shown !== undefined && shown.value !== null && shown.clock !== null;
        return (
          <li key={tile.key} className={measured ? "tuile" : "tuile tuile-vide"} data-tuile={tile.key}>
            <span className="tuile-icone">
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                {tile.icon}
              </svg>
            </span>
            <span className="tuile-corps">
              <span className="tuile-titre">{tile.title}</span>
              <span className="tuile-valeur">
                {shown && shown.value !== null && shown.clock !== null
                  ? shown.clock === "bloc"
                    ? formatDurationS(shown.value)
                    : formatDurationMs(shown.value)
                  : "non mesuré"}
              </span>
              <span className="tuile-mesure">
                {shown ? shown.label : "mesure absente"}
                {shown && shown.clock !== null && (
                  <>
                    {" "}
                    <ClockTag clock={shown.clock} />
                  </>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Report({ item, chainPause, fakeVault }: { item: IncidentItem; chainPause: number | null; fakeVault: boolean }) {
  const { report } = item;
  const contract = report.contract ? readDecision({ ...report.contract, effective_decision: report.contract.decision }) : null;
  return (
    <div className="rapport" data-testid="rapport">
      <header className="rapport-entete">
        <p className="rapport-titre">
          <OpaqueId value={report.incident_id} /> <span aria-hidden="true">—</span> {TRIGGER_LABELS[report.trigger]}
        </p>
        <span className={report.human_decision === null ? "statut statut-ouvert" : "statut statut-qualifie"}>
          <strong data-testid="etat-incident">{report.human_decision === null ? "ouvert" : "qualifié par un humain"}</strong>
        </span>
        <p className="rapport-date">
          Rapport généré le {formatDateTime(report.generated_at_ms)} <ClockTag clock="journal" />
        </p>
      </header>

      <DelayTiles delays={computeDelays(report, chainPause)} />

      <dl className="fiche">
        <div>
          <dt>Déclencheur</dt>
          <dd>{TRIGGER_LABELS[report.trigger]}</dd>
        </div>
        <div>
          <dt>Demandes</dt>
          <dd>
            {report.request_ids.map((id) => (
              <span key={id} className="jeton">
                <OpaqueId value={id} />
              </span>
            ))}
          </dd>
        </div>
      </dl>

      <h3>Codes raison et score</h3>
      <dl className="fiche">
        <div>
          <dt>Score du détecteur</dt>
          <dd data-testid="score">
            {report.detector.score === null ? <span className="indisponible">le détecteur n'a pas tourné</span> : report.detector.score} pour un
            seuil de {report.detector.threshold}
          </dd>
        </div>
        <div>
          <dt>Codes raison</dt>
          <dd data-testid="codes">
            {report.detector.reason_codes.length === 0
              ? "aucun : la demande a passé la porte d'entrée"
              : report.detector.reason_codes.map((code) => `${detectorCodeLabel(code)} (${code})`).join(", ")}
          </dd>
        </div>
      </dl>

      <h3>
        Décision du contrat{" "}
        {fakeVault && (
          <span data-testid="decision-contrat-simulee">
            <SourceTag source="faux-coffre" /> faux coffre : aucun contrat n'a jugé
          </span>
        )}
      </h3>
      <div data-testid="decision-contrat">
        {report.contract === null || contract === null ? (
          <p>Contrat non atteint : la demande a été arrêtée avant lui.</p>
        ) : (
          <p>
            <DecisionBadge kind={contract.kind} /> <span className="synthese">{contract.summary}</span>{" "}
            <span className="discret">
              · bloc {report.contract.block_number} ({formatTime(report.contract.block_timestamp * 1000)}) · transaction{" "}
              <OpaqueId value={report.contract.tx_hash} />
            </span>
          </p>
        )}
      </div>

      <h3>Montants</h3>
      <dl className="fiche">
        <div>
          <dt>Montant exposé (inscrit au contrat)</dt>
          <dd data-testid="expose">
            <Amount wei={report.amounts.exposed_wei} missing="inconnu du contrat" />
          </dd>
        </div>
        <div>
          <dt>Montant effectivement sorti</dt>
          <dd data-testid="sorti">
            <Amount wei={report.amounts.out_wei} />
          </dd>
        </div>
      </dl>

      <h3>Actions automatiques</h3>
      {report.automatic_actions.length === 0 ? (
        <p className="vide">Aucune action automatique.</p>
      ) : (
        <ol className="actions" data-testid="actions">
          {report.automatic_actions.map((a) => (
            <li key={`${a.action}:${a.journal_seq}`}>
              <span className="synthese">{ACTION_TAKEN_LABELS[a.action]}</span>{" "}
              <span className="discret">
                · {formatTime(a.at_ms)} · entrée {a.journal_seq} du journal
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="discret">Les actions automatiques ne font que bloquer : aucune ne déplace de fonds.</p>

      <h3>Délais</h3>
      <DelaysTable report={report} chainPause={chainPause} />
      <DelaysNote />

      <h3>Chaîne d'autorité</h3>
      <dl className="fiche">
        <div>
          <dt>Agent d'origine</dt>
          <dd>
            <OpaqueId value={report.authority_chain.agent_id} />
          </dd>
        </div>
        <div>
          <dt>Mandat de l'agent</dt>
          <dd>
            {report.authority_chain.agent_mandate.length === 0
              ? "aucun"
              : report.authority_chain.agent_mandate.map((m) => MANDATE_LABELS[m] ?? "inconnu").join(", ")}
          </dd>
        </div>
        <div>
          <dt>Client</dt>
          <dd>
            <OpaqueId value={report.authority_chain.client_id} />
          </dd>
        </div>
        <div>
          <dt>Signataire du client</dt>
          <dd>
            <OpaqueId value={report.authority_chain.client_signer} missing="demande jamais signée" />
          </dd>
        </div>
        <div>
          <dt>Transaction du relais</dt>
          <dd>
            <OpaqueId value={report.authority_chain.relay_tx_hash} missing="demande jamais soumise" />
          </dd>
        </div>
      </dl>

      <h3>Décision humaine</h3>
      <p data-testid="decision-humaine">
        {report.human_decision === null ? (
          "Aucune pour l'instant : l'incident reste ouvert. Une pause ne se lève que par un humain habilité."
        ) : (
          <>
            {HUMAN_DECISION_LABELS[report.human_decision.decision] ?? "décision inconnue"} · {ROLE_LABELS[report.human_decision.author_role] ?? "rôle inconnu"}{" "}
            <OpaqueId value={report.human_decision.author_id} /> · {formatDateTime(report.human_decision.at_ms)}
          </>
        )}
      </p>

      <h3>Empreinte du journal au moment du rapport</h3>
      <p>
        Entrée {report.journal_head.seq} · <OpaqueId value={report.journal_head.hash} />
      </p>

      <h3>Extrait du document en quarantaine</h3>
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
    </div>
  );
}

export function IncidentView({ view }: { view: ViewProps }) {
  const { relay, response, sources, now } = view;
  const [selected, setSelected] = useState<string | null>(null);
  const linked = sameWorld(sources);
  // Effet d : un incident apparu depuis l'ouverture de la page. Les plus anciens d'abord pour useArrival.
  const known = response.data ? latestIncidents(response.data.incidents) : null;
  const arrival = useArrival<{ key: string }>([known ? [...known].reverse().map((i) => ({ key: i.report.incident_id })) : null]);
  return (
    <>
      <Panel title="Incidents" id="titre-incidents" source={sources.response} snapshot={response} now={now}>
        {(data) => {
          const incidents = latestIncidents(data.incidents);
          const open = incidents.filter((i) => i.report.human_decision === null).length;
          const missed = incidents.filter((i) => i.report.trigger === "CONTRACT_REFUSAL").length;
          const current = incidents.find((i) => i.report.incident_id === selected) ?? incidents[0];
          const pause =
            current && linked && relay.data && current.report.contract
              ? chainPauseTimestamp(relay.data.events, current.report.authority_chain.agent_id, current.report.contract.block_number)
              : null;
          // Agents en pause : hors chaîne (service de réponse), sur la chaîne (événements, seulement s'ils sont du même monde).
          const offchain = new Set(data.pausedAgents.filter((p) => p.scope === "OFFCHAIN").map((p) => p.agent_id));
          const onchain = new Set(linked && relay.data ? chainPausedAgents(relay.data.events).map((p) => p.agentId) : []);
          return (
            <>
              <dl className="compteurs">
                <div>
                  <dt>Incidents ouverts</dt>
                  <dd data-testid="compteur-ouverts">
                    <Counter value={open} />
                  </dd>
                </div>
                <div>
                  <dt>Passées la porte puis bloquées par le contrat</dt>
                  <dd data-testid="compteur-manquees">
                    <Counter value={missed} />
                  </dd>
                </div>
              </dl>
              {incidents.length === 0 ? (
                <p className="vide">Aucun incident.</p>
              ) : (
                <div className="incidents-grille">
                  <div className="incidents-colonne">
                    <h3 className="incidents-titre">Incidents récents</h3>
                    <ul className="incidents-liste" aria-label="Choisir un incident">
                      {incidents.map((i) => {
                        const id = i.report.incident_id;
                        const agent = i.report.authority_chain.agent_id;
                        const fresh = arrival !== null && arrival.item.key === id;
                        const scopes = [offchain.has(agent) ? "hors chaîne" : null, onchain.has(agent) ? "sur la chaîne" : null].filter((x) => x !== null);
                        return (
                          <li
                            // Nouvelle clé à l'arrivée : la carte rejoue son entrée, une fois.
                            key={fresh ? `${id}:${arrival.count}` : id}
                            className={fresh ? "carte-incident carte-arrivee" : "carte-incident"}
                            data-testid="carte-incident"
                            data-arrivee={fresh ? "true" : "false"}
                          >
                            <button type="button" data-ui="navigation" aria-pressed={i === current} onClick={() => setSelected(id)}>
                              <span className="carte-ligne">
                                <OpaqueId value={id} />
                                <span className={i.report.human_decision === null ? "statut statut-ouvert" : "statut statut-qualifie"}>
                                  {i.report.human_decision === null ? "ouvert" : "qualifié"}
                                </span>
                                <span className="carte-heure">{formatTime(i.report.generated_at_ms)}</span>
                              </span>
                              <span className="carte-titre">{TRIGGER_LABELS[i.report.trigger]}</span>
                              <span className="carte-agent">
                                Agent <OpaqueId value={agent} />
                                {scopes.length > 0 && <PauseBadge scopes={scopes} />}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  {/* Nouvelle clé à chaque incident choisi : le rapport entre en fondu. */}
                  {current && <Report key={current.report.incident_id} fakeVault={vaultFed(sources.relay, view.vaultOrigin) === "faux-coffre"} item={current} chainPause={pause} />}
                </div>
              )}
            </>
          );
        }}
      </Panel>

      <div className="grille-bas">
        <Panel title="Agents en pause, hors chaîne" id="titre-pauses" source={sources.response} snapshot={response} now={now}>
          {(data) => {
            const offchain = data.pausedAgents.filter((p) => p.scope === "OFFCHAIN");
            return offchain.length === 0 ? (
              <p className="vide">Aucun agent en pause.</p>
            ) : (
              <ul className="hors-contrat">
                {offchain.map((p) => (
                  <li key={`${p.agent_id}:${p.paused_at_ms}`} data-testid="agent-en-pause">
                    <PauseBadge scopes={["hors chaîne"]} /> Agent <OpaqueId value={p.agent_id} /> en pause depuis {formatTime(p.paused_at_ms)} <ClockTag clock="journal" />{" "}
                    <span className="discret">
                      · incident <OpaqueId value={p.incident_id} />
                    </span>
                  </li>
                ))}
              </ul>
            );
          }}
        </Panel>
        <Panel title="Agents en pause, sur la chaîne" id="titre-pauses-chaine" source={vaultFed(sources.relay, view.vaultOrigin)} snapshot={relay} now={now}>
          {(data) => {
            const onchain = chainPausedAgents(data.events);
            return onchain.length === 0 ? (
              <p className="vide">Aucun agent en pause sur la chaîne.</p>
            ) : (
              <ul className="hors-contrat">
                {onchain.map((p) => (
                  <li key={p.agentId} data-testid="agent-en-pause-chaine">
                    <PauseBadge scopes={["sur la chaîne"]} /> Agent <OpaqueId value={p.agentId} /> en pause depuis le bloc {p.blockNumber} ({formatTime(p.blockTimestamp * 1000)}){" "}
                    <ClockTag clock="bloc" />
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
