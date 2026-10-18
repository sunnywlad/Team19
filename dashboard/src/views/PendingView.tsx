import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { JournalEntry, RelayDecision, RelayEvent } from "../api/types.ts";
import { Nom, libelleOf } from "../components/Affichage.tsx";
import { Amount, ClockTag, Details, OpaqueId, Vide } from "../components/atoms.tsx";
import { Icon, type IconName } from "../components/icons.tsx";
import { Panel } from "../components/Panel.tsx";
import { CaseStatePill } from "../components/pills.tsx";
import { approverAlertAt } from "../domain/activity.ts";
import { registeredAmount } from "../domain/apercu.ts";
import { actionLabel } from "../domain/reasons.ts";
import {
  CASE_STATE_WORDS,
  closedCases,
  controlsFor,
  formatCountdown,
  historyFor,
  openCases,
  remainingS,
  type CaseState,
  type ClosedCase,
  type ControlState,
  type OpenCase,
} from "../domain/validation.ts";
import { useAffichage } from "../hooks/useAffichage.ts";
import { formatDateTime, formatTime, formatWei } from "../lib/format.ts";
import { sameWorld, vaultFed, type ViewProps } from "./shared.ts";

const TABS: CaseState[] = ["attente", "valide", "rejete", "expire"];

/** Échéance en mots : temps restant estimé, ou dépassée. */
function Deadline({ deadline, now }: { deadline: number | null; now: number }) {
  const remaining = remainingS(deadline, now);
  if (remaining === null) return <span className="indisponible">non disponible</span>;
  if (remaining <= 0) return <strong className="echeance-depassee">échéance dépassée : sans réponse humaine, la demande est refusée</strong>;
  return (
    <span className="cellule">
      <b className={remaining <= 300 ? "echeance-proche" : undefined}>dans {formatCountdown(remaining)}</b>{" "}
      <span>avant {formatTime((deadline as number) * 1000)}, estimé</span>
    </span>
  );
}

const CONTROL_ICONS: Record<ControlState, IconName> = { ok: "check", attention: "doute", inconnu: "info" };
const CONTROL_WORDS: Record<ControlState, string> = { ok: "conforme", attention: "à examiner", inconnu: "non vérifiable ici" };

type DrawerProps = {
  c: OpenCase;
  events: RelayEvent[];
  decisions: RelayDecision[];
  journal: JournalEntry[] | null;
  now: number;
  onClose: () => void;
};

/**
 * Tiroir d'un cas en attente. Il montre ce que le contrat a inscrit et ce que
 * le journal atteste, jamais la justification rédigée par un agent. Option A :
 * la console ne détient aucune clé, le bouton vers l'app d'approbation reste
 * désactivé tant que l'app n'existe pas.
 */
function Drawer({ c, events, decisions, journal, now, onClose }: DrawerProps) {
  const { unite, libelles } = useAffichage();
  const format = (wei: string | null): string => {
    const text = formatWei(wei, unite.decimales);
    return text === null ? "montant non disponible" : `${text} ${unite.symbole}`;
  };
  const close = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    // Le clavier entre dans le tiroir ; il revient à la ligne choisie à la fermeture.
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => previous?.focus();
  }, []);
  const controls = controlsFor(c, events, journal, format);
  const history = historyFor(c.requestId, journal, decisions);
  const notified = journal === null ? null : approverAlertAt(c.requestId, journal);
  const remaining = remainingS(c.deadline, now);
  const beneficiary = libelleOf(libelles, c.beneficiaryId, "beneficiaire");
  const agent = libelleOf(libelles, c.agentId, "agent");
  const titleId = `tiroir-${c.requestId.slice(2, 10)}`;
  const onKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    // Tiroir modal : la tabulation tourne dans le tiroir.
    if (event.key !== "Tab" || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']")];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  // Rendu sous <body> : aucun parent animé ou filtré (valeurs périmées) ne déplace le tiroir.
  return createPortal(
    <>
      <div className="voile" aria-hidden="true" onClick={onClose} />
      <aside className="tiroir" role="dialog" aria-modal="true" aria-labelledby={titleId} data-tiroir-ouvert="oui" data-testid="tiroir" onKeyDown={onKey} ref={panel}>
        <header className="tiroir-entete">
          <div className="tiroir-titre">
            <p className="discret">
              Demande <OpaqueId value={c.requestId} /> · proposée par <Nom id={c.agentId} genre="agent" />
            </p>
            <h2 id={titleId}>{beneficiary ? beneficiary.libelle : <Nom id={c.beneficiaryId} missing="Bénéficiaire non lu" />}</h2>
            <p className="gros-montant" data-testid="tiroir-montant">
              <Amount wei={c.amountWei} />
            </p>
            <CaseStatePill state="attente" />
          </div>
          <button type="button" className="fermer" data-ui="navigation" ref={close} onClick={onClose} aria-keyshortcuts="Escape">
            <Icon name="x" />
            <span className="visuellement-cache">Fermer le détail</span>
          </button>
        </header>

        <div className="tiroir-corps" tabIndex={0} role="region" aria-label="Détail du cas">
          <section className="encadre encadre-attente" aria-labelledby={`${titleId}-pourquoi`}>
            <h3 id={`${titleId}-pourquoi`}>Pourquoi ce paiement attend une décision humaine</h3>
            <p data-testid="tiroir-pourquoi">{controls.find((k) => k.key === "seuil")?.detail ?? "montant au-dessus du seuil de validation"}. Le contrat a bloqué le montant et attend un approbateur.</p>
          </section>

          <section aria-labelledby={`${titleId}-controles`}>
            <h3 className="titre-section" id={`${titleId}-controles`}>
              Contrôles
            </h3>
            <ul className="controles" data-testid="controles">
              {controls.map((k) => (
                <li key={k.key} data-controle={k.key} data-etat={k.state}>
                  <span className={`controle-etat controle-${k.state}`}>
                    <Icon name={CONTROL_ICONS[k.state]} />
                    <span className="visuellement-cache">{CONTROL_WORDS[k.state]}</span>
                  </span>
                  <span className="controle-nom">{k.label}</span>
                  <span className="controle-valeur">
                    {k.detail}
                    {k.code !== null && (
                      <>
                        {" "}
                        <code className="controle-code">{k.code}</code>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <Details>
              <p className="discret">
                Déduits du motif de la décision et de l'entrée DETECTION du journal. « Écart à l'habitude » et « doublon possible » ne sont pas
                calculés : ils n'apparaissent pas.
              </p>
            </Details>
          </section>

          <section aria-labelledby={`${titleId}-faits`}>
            <h3 className="titre-section" id={`${titleId}-faits`}>
              {c.action === 2 ? "Placement et bénéficiaire" : "Facture et bénéficiaire"}
            </h3>
            <dl className="kv">
              <dt>{c.action === 2 ? "Placement" : "Facture"}</dt>
              <dd data-testid="tiroir-reference">
                <Nom id={c.refId} withId /> <span className="discret">· {actionLabel(c.action)}</span>
              </dd>
              <dt>Montant inscrit</dt>
              <dd>
                <Amount wei={registeredAmount(c.refId, events)} />
              </dd>
              <dt>Bénéficiaire inscrit</dt>
              <dd data-testid="tiroir-beneficiaire">
                <Nom id={c.beneficiaryId} genre="beneficiaire" withId missing="non disponible" />
                {(beneficiary?.sous_titre ?? beneficiary?.detail) && <span className="discret"> · {beneficiary?.sous_titre ?? beneficiary?.detail}</span>}
              </dd>
              {beneficiary?.siren && (
                <>
                  <dt>SIREN</dt>
                  <dd data-testid="tiroir-siren">{beneficiary.siren}</dd>
                </>
              )}
              {beneficiary?.iban_masque && (
                <>
                  <dt>IBAN au référentiel</dt>
                  <dd className="mono" data-testid="tiroir-iban">
                    {beneficiary.iban_masque}
                  </dd>
                </>
              )}
              <dt>Agent</dt>
              <dd>
                <Nom id={c.agentId} genre="agent" withId />
                {agent?.detail && <span className="discret"> · {agent.detail}</span>}
              </dd>
              <dt>Décision du contrat</dt>
              <dd>
                bloc {c.blockNumber} · {formatDateTime(c.blockTimestamp * 1000)} <ClockTag clock="bloc" />
              </dd>
              <dt>Approbateur notifié</dt>
              <dd>
                {notified === null ? (
                  <span className="indisponible">{journal === null ? "non disponible" : "aucune notification au journal"}</span>
                ) : (
                  <>
                    {formatTime(notified)} <ClockTag clock="journal" />
                  </>
                )}
              </dd>
            </dl>
          </section>

          <section aria-labelledby={`${titleId}-historique`}>
            <h3 className="titre-section" id={`${titleId}-historique`}>
              Historique
            </h3>
            <ol className="chrono" data-testid="historique">
              {history.map((h) => (
                <li key={h.key}>
                  <span className={h.clock === "bloc" ? "pt pt-attente" : "pt"} aria-hidden="true" />
                  <span>{h.label}</span>
                  <time>
                    {formatTime(h.atMs)} <ClockTag clock={h.clock} />
                  </time>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="tiroir-pied">
          <p className="echeance" data-testid="tiroir-echeance">
            <Icon name="horloge" />
            {remaining === null
              ? "Échéance non disponible. Sans réponse humaine à l'échéance, le paiement est refusé."
              : remaining > 0
                ? `Sans réponse avant ${formatTime((c.deadline as number) * 1000)} (dans ${formatCountdown(remaining)}, estimé), le paiement est refusé.`
                : "Échéance dépassée : sans réponse humaine, le paiement est refusé."}
          </p>
          <p className="sans-cle" data-testid="sans-cle">
            <Icon name="cle-barree" />
            Cette console ne détient aucune clé : la décision se signe dans l'app d'approbation, avec la clé de l'approbateur
          </p>
          <div className="tiroir-actions">
            {/* Le bouton reste inerte : l'infobulle est portée par son conteneur, qui reçoit le survol. */}
            <span className="infobulle-conteneur" title="À venir">
              <button type="button" className="btn btn-primaire" disabled aria-describedby={`${titleId}-a-venir`}>
                <Icon name="mobile" />
                Ouvrir dans l'app d'approbation
              </button>
              <span className="visuellement-cache" id={`${titleId}-a-venir`}>
                À venir
              </span>
            </span>
          </div>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

function ClosedTable({ cases, state }: { cases: ClosedCase[]; state: Exclude<CaseState, "attente"> }) {
  const rows = cases.filter((c) => c.state === state);
  if (rows.length === 0) return <Vide className="carte-vide">Aucun cas {CASE_STATE_WORDS[state].toLowerCase()} pour l'instant.</Vide>;
  return (
    <div className="defilement" role="region" aria-label={`Cas ${CASE_STATE_WORDS[state].toLowerCase()}s`} tabIndex={0}>
      <table className="tableau">
        <thead>
          <tr>
            <th scope="col">Référence</th>
            <th scope="col" className="droite">
              Montant
            </th>
            <th scope="col">Agent</th>
            <th scope="col">Issue</th>
            <th scope="col">Clôture</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.requestId} data-testid="cas-clos">
              <td data-label="Référence">
                <Nom id={c.refId} />
              </td>
              <td data-label="Montant" className="droite">
                <Amount wei={c.amountWei} />
              </td>
              <td data-label="Agent">
                <Nom id={c.agentId} genre="agent" />
              </td>
              <td data-label="Issue">
                <CaseStatePill state={c.state} />
              </td>
              <td data-label="Clôture">
                bloc {c.closedBlock} · {formatTime(c.closedAtS * 1000)} <ClockTag clock="bloc" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * À valider : les cas que le contrat a renvoyés à un humain (décision 1). Seuls
 * les faits inscrits au contrat sont montrés : la référence, le montant, le
 * bénéficiaire, l'échéance. La justification rédigée par un agent n'est jamais
 * affichée, et rien ici ne permet d'approuver ou de refuser.
 */
export function PendingView({ view }: { view: ViewProps }) {
  const { relay, response, sources, vaultOrigin, now } = view;
  // Le journal ne se rapproche des demandes du relais que s'ils sont du même monde.
  const journal = sameWorld(sources) ? (response.data?.journal ?? null) : null;
  const [tab, setTab] = useState<CaseState>("attente");
  const [selected, setSelected] = useState<string | null>(null);
  const cases = relay.data ? openCases(relay.data.decisions, relay.data.events) : [];

  // J et K : cas suivant, cas précédent, tiroir ouvert sur lui. Hors d'un champ et sans modificateur.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || tab !== "attente" || cases.length === 0) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      const index = cases.findIndex((c) => c.requestId === selected);
      const next = key === "j" ? Math.min(cases.length - 1, index + 1) : index === -1 ? 0 : Math.max(0, index - 1);
      setSelected(cases[next]?.requestId ?? null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Panel title="Demandes renvoyées à un humain" id="titre-attente" source={vaultFed(sources.relay, vaultOrigin)} famille="relay" snapshot={relay} now={now} className="carte-liste">
      {(data) => {
        const closed = closedCases(data.decisions, data.events);
        const counts: Record<CaseState, number> = {
          attente: cases.length,
          valide: closed.filter((c) => c.state === "valide").length,
          rejete: closed.filter((c) => c.state === "rejete").length,
          expire: closed.filter((c) => c.state === "expire").length,
        };
        const current = cases.find((c) => c.requestId === selected) ?? null;
        return (
          <>
            <div className="onglets" role="tablist" aria-label="Issue des cas">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  data-ui="affichage"
                  aria-selected={tab === t}
                  aria-controls="liste-cas"
                  onClick={() => {
                    setTab(t);
                    setSelected(null);
                  }}
                >
                  {CASE_STATE_WORDS[t]} <span className="n">{counts[t]}</span>
                </button>
              ))}
            </div>
            <div id="liste-cas" role="tabpanel">
              {tab !== "attente" ? (
                <ClosedTable cases={closed} state={tab} />
              ) : cases.length === 0 ? (
                <Vide className="carte-vide" hint="L'approbateur est notifié à chaque nouvelle demande au-dessus du seuil.">
                  Aucune demande n'attend votre décision.
                </Vide>
              ) : (
                <div className="defilement" role="region" aria-label="Cas en attente" tabIndex={0}>
                  <table className="tableau">
                    <thead>
                      <tr>
                        <th scope="col">Bénéficiaire</th>
                        <th scope="col" className="droite">
                          Montant bloqué
                        </th>
                        <th scope="col">Agent</th>
                        <th scope="col">Pourquoi</th>
                        <th scope="col">Échéance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cases.map((c) => (
                        <tr
                          key={c.requestId}
                          data-testid="cas-en-attente"
                          className="clic"
                          aria-selected={selected === c.requestId}
                          onClick={() => setSelected(c.requestId)}
                        >
                          <td data-label="Bénéficiaire">
                            <button type="button" className="ligne-bouton" data-ui="navigation" onClick={() => setSelected(c.requestId)}>
                              <span className="cellule">
                                <b data-testid="cas-beneficiaire">
                                  <Nom id={c.beneficiaryId} genre="beneficiaire" missing="non disponible" />
                                </b>{" "}
                                <span data-testid="cas-reference">
                                  <Nom id={c.refId} /> · {actionLabel(c.action)}
                                </span>
                              </span>
                            </button>
                          </td>
                          <td data-label="Montant bloqué" className="droite" data-testid="cas-montant">
                            <Amount wei={c.amountWei} />
                          </td>
                          <td data-label="Agent">
                            <Nom id={c.agentId} genre="agent" />
                          </td>
                          <td data-label="Pourquoi">au-dessus du seuil</td>
                          <td data-label="Échéance" data-testid="cas-delai">
                            <Deadline deadline={c.deadline} now={now} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {tab === "attente" && cases.length > 0 && (
              <p className="discret carte-note">
                <kbd>J</kbd> et <kbd>K</kbd> : cas suivant et précédent ; <kbd>Échap</kbd> ferme le détail.
              </p>
            )}
            <div className="carte-note">
              <Details>
                <p className="discret">
                  Faits inscrits au contrat, lus dans ses événements. La justification rédigée par un agent n'est jamais affichée. L'échéance est
                  en heure de bloc, comparée ici à l'horloge locale du navigateur <ClockTag clock="bloc" /> : le temps restant est estimé.
                </p>
              </Details>
            </div>
            {current && <Drawer key={current.requestId} c={current} events={data.events} decisions={data.decisions} journal={journal} now={now} onClose={() => setSelected(null)} />}
          </>
        );
      }}
    </Panel>
  );
}
