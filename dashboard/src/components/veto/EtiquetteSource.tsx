import type { TagSource } from "../../api/types.ts";
import { formatTime } from "../../lib/format.ts";

type Props =
  /** D'où vient la valeur : jamais « réel » par défaut. */
  | { kind: "source"; source: TagSource }
  /** Lecture datée : « relais · lu 14:12 ». lastOkAt null : jamais lue. */
  | { kind: "lecture"; from: string; lastOkAt: number | null }
  | { kind: "non-mesure" };

/**
 * Étiquette de source : d'où vient une valeur, et quand elle a été lue. La forme
 * porte le sens autant que la couleur : plein (réel), tirets hachurés
 * (simulation), pointillé et « ? » (origine non confirmée), pointillé et « — »
 * (non mesuré). Ce n'est pas un statut de sécurité.
 */
export function EtiquetteSource(props: Props) {
  if (props.kind === "non-mesure") return <span className="veto-source veto-source-nonmesure">non mesuré</span>;
  if (props.kind === "lecture") {
    if (props.lastOkAt === null) return <span className="veto-source veto-source-nonmesure">{props.from} · jamais lu</span>;
    return (
      <span className="veto-source veto-source-lecture">
        {props.from} · lu {formatTime(props.lastOkAt)}
      </span>
    );
  }
  if (props.source === "reel") return <span className="veto-source veto-source-reel">réel</span>;
  if (props.source === "non-confirme") {
    return (
      <span className="veto-source veto-source-incertain" title="Le proxy local n'a pas dit si le relais lit un contrat ou un faux coffre">
        origine non confirmée
      </span>
    );
  }
  return (
    <span
      className="veto-source veto-source-simulation"
      title={props.source === "faux-coffre" ? "Faux coffre en mémoire dans le relais : aucun fonds, aucune chaîne" : "Point d'accès simulé : voir API-NEEDS.md"}
    >
      simulation
    </span>
  );
}
