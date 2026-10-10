import { chainVaultPaused, relayUnavailable } from "../domain/activity.ts";
import { isStale } from "../hooks/poller.ts";
import { formatTime } from "../lib/format.ts";
import { sameWorld, type ViewProps } from "../views/shared.ts";
import { SourceTag } from "./atoms.tsx";

const NAMES = { relay: "relais", vault: "coffre", response: "service de réponse" } as const;

/** Heure de la dernière lecture réussie de chaque famille de données. */
export function Freshness({ relay, vault, response, sources, now }: ViewProps) {
  const rows = [
    { key: "relay" as const, snapshot: relay },
    { key: "vault" as const, snapshot: vault },
    { key: "response" as const, snapshot: response },
  ];
  return (
    <ul className="fraicheur" aria-label="Dernière mise à jour par source">
      {rows.map(({ key, snapshot }) => (
        <li key={key} className={isStale(snapshot, now) ? "perime" : undefined}>
          <span className="fraicheur-nom">{NAMES[key]}</span> <SourceTag source={sources[key]} />{" "}
          <span data-testid={`maj-${key}`}>
            {snapshot.lastOkAt === null ? "jamais lu" : `mis à jour à ${formatTime(snapshot.lastOkAt)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Banners({ relay, vault, response, sources, now }: ViewProps) {
  const stale = [
    isStale(relay, now) ? NAMES.relay : null,
    isStale(vault, now) ? NAMES.vault : null,
    isStale(response, now) ? NAMES.response : null,
  ].filter((name) => name !== null);
  const queueStuck = sameWorld(sources) && relay.data !== null && response.data !== null && relayUnavailable(response.data.journal, relay.data.queue);
  const vaultPaused = relay.data !== null && chainVaultPaused(relay.data.events);
  return (
    <div className="bandeaux">
      {stale.length > 0 && (
        <p className="bandeau bandeau-erreur" role="alert">
          <strong>Données indisponibles</strong> : {stale.join(", ")} injoignable{stale.length > 1 ? "s" : ""} depuis plus de 10 s. Les valeurs
          grisées sont périmées.
        </p>
      )}
      {queueStuck && (
        <p className="bandeau bandeau-alerte" role="status">
          <strong>Relais indisponible</strong> : une demande attend en file sans être soumise. Rien n'est autorisé par défaut.
        </p>
      )}
      {vaultPaused && (
        <p className="bandeau bandeau-alerte" role="status">
          <strong>Coffre en pause</strong> sur la chaîne : aucune sortie tant que le propriétaire ne l'a pas levée.
        </p>
      )}
    </div>
  );
}
