// La table ronde de la demande sélectionnée, sur l'accueil. Par défaut : la
// première demande qui attend un humain, sinon la plus récemment vue.
import { pendingCases } from "../domain/activity.ts";
import { knownRequests, overall, seatsFor, VERDICT_WORDS } from "../domain/table.ts";
import { formatWei, UNIT_LABEL } from "../lib/format.ts";
import { sameWorld, vaultFed, type ViewProps } from "../views/shared.ts";
import { OpaqueId } from "./atoms.tsx";
import { Panel } from "./Panel.tsx";
import { RoundTable } from "./RoundTable.tsx";

const WEI = /^(0|[1-9][0-9]{0,77})$/;
const MAX_CHOICES = 6;

type Props = { view: ViewProps; selected: string | null; onSelect: (requestId: string) => void };

export function RoundTablePanel({ view, selected, onSelect }: Props) {
  const { relay, response, sources, vaultOrigin, now } = view;
  const linked = sameWorld(sources);
  return (
    <Panel title="Table ronde" id="titre-table" source={vaultFed(sources.relay, vaultOrigin)} snapshot={relay} now={now} className="panneau-table">
      {(data) => {
        const journal = linked ? (response.data?.journal ?? null) : null;
        const known = knownRequests(data.decisions, data.queue, journal);
        if (known.length === 0) return <p className="vide">Aucune demande pour l'instant : la table est vide.</p>;
        const pending = pendingCases(data.decisions, data.events)[0]?.requestId;
        const current = known.find((k) => k.requestId === selected)?.requestId ?? pending ?? known[0]?.requestId ?? null;
        if (current === null) return null;
        const seats = seatsFor({ requestId: current, decisions: data.decisions, queue: data.queue, journal });
        // Montant inscrit au contrat pour cette demande : payé (Paid) ou bloqué (HoldPlaced). Rien d'autre.
        const paid = data.events.find((e) => e.name === "Paid" && e.args.requestId === current);
        const held = data.events.find((e) => e.name === "HoldPlaced" && e.args.requestId === current);
        const event = paid ?? held;
        const amount = typeof event?.args.amount === "string" && WEI.test(event.args.amount) ? formatWei(event.args.amount) : null;
        const choices = known.slice(0, MAX_CHOICES);
        if (!choices.some((c) => c.requestId === current)) choices.push({ requestId: current, lastMs: 0 });
        return (
          <>
            <ul className="selecteur" aria-label="Choisir une demande">
              {choices.map((k) => {
                const word = overall(seatsFor({ requestId: k.requestId, decisions: data.decisions, queue: data.queue, journal })).verdict;
                return (
                  <li key={k.requestId}>
                    <button type="button" data-ui="navigation" aria-pressed={k.requestId === current} onClick={() => onSelect(k.requestId)}>
                      <OpaqueId value={k.requestId} /> · {word === "inconnu" ? VERDICT_WORDS.inconnu : word === "passe" ? "passée" : word === "veto" ? "veto" : "en attente"}
                    </button>
                  </li>
                );
              })}
            </ul>
            <RoundTable
              key={current}
              seats={seats}
              requestId={current}
              detail={
                <p className="table-detail">
                  demande <OpaqueId value={current} />
                  {amount !== null && (
                    <>
                      {" "}
                      · <span className="montant">{amount} {UNIT_LABEL}</span> {paid ? "payé" : "bloqué"}
                    </>
                  )}
                </p>
              }
            />
            <p className="discret table-note">
              Un siège par couche du flux, rien de plus. Chaque verdict est lu dans les traces de sa couche : journal, file du relais, événements du
              contrat. Sans trace : « non disponible » ou « non atteint », jamais « passé ».
            </p>
          </>
        );
      }}
    </Panel>
  );
}
