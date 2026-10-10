import type { OffContractLine } from "../domain/activity.ts";
import { formatTime } from "../lib/format.ts";
import { OpaqueId, SourceTag, Untrusted } from "./atoms.tsx";
import { ReactionCell, type Reaction } from "./DecisionsTable.tsx";
import type { Sources } from "../api/types.ts";

type Props = { lines: OffContractLine[]; sources: Sources; reactionFor: (requestId: string) => Reaction };

/** Demandes que le contrat n'a pas vues : arrêtées à la porte d'entrée, ou restées en file. */
export function OffContractList({ lines, sources, reactionFor }: Props) {
  if (lines.length === 0) return <p className="vide">Aucune demande arrêtée avant le contrat.</p>;
  return (
    <ul className="hors-contrat">
      {lines.map((line) => (
        <li key={line.key} data-testid="hors-contrat">
          <p>
            <span className="synthese">{line.summary}</span>
            {line.detail !== null && <span> : {line.detail}</span>}
            {line.untrusted !== null && (
              <span>
                {" "}
                · cause donnée par le relais (contenu non fiable) : <Untrusted text={line.untrusted} max={80} />
              </span>
            )}
          </p>
          <p className="discret">
            Demande <OpaqueId value={line.requestId} /> · agent{" "}
            {line.agentId === null ? "non authentifié" : <OpaqueId value={line.agentId} />} · {formatTime(line.atMs)} ·{" "}
            {line.origin === "journal" ? "journal" : "file du relais"} <SourceTag source={line.origin === "journal" ? sources.response : sources.relay} />
            {line.requestId !== null && (
              <>
                {" "}
                · réponse : <ReactionCell reaction={reactionFor(line.requestId)} />
              </>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
