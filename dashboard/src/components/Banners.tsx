import { chainVaultPaused, relayUnavailable } from "../domain/activity.ts";
import { isStale } from "../hooks/poller.ts";
import { formatTime } from "../lib/format.ts";
import { sameWorld, vaultFed, type ViewProps } from "../views/shared.ts";
import { SourceTag } from "./atoms.tsx";

const NAMES = { relay: "relais", vault: "coffre", response: "service de réponse" } as const;

/** Heure de la dernière lecture réussie de chaque famille de données. */
export function Freshness({ view }: { view: ViewProps }) {
  const { relay, vault, response, sources, vaultOrigin, now } = view;
  const rows = [
    { key: "relay" as const, snapshot: relay },
    { key: "vault" as const, snapshot: vault },
    { key: "response" as const, snapshot: response },
  ];
  return (
    <ul className="fraicheur" aria-label="Dernière mise à jour par source">
      {rows.map(({ key, snapshot }) => (
        <li key={key} className={isStale(snapshot, now) ? "perime" : undefined}>
          <span className="fraicheur-nom">{NAMES[key]}</span> <SourceTag source={key === "vault" ? vaultFed(sources.vault, vaultOrigin) : sources[key]} />{" "}
          <span data-testid={`maj-${key}`}>
            {snapshot.lastOkAt === null ? "jamais lu" : `mis à jour à ${formatTime(snapshot.lastOkAt)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Banners({ view }: { view: ViewProps }) {
  const { relay, vault, response, sources, vaultOrigin, now } = view;
  const fake = sources.relay === "reel" && vaultOrigin === "faux-coffre";
  const unconfirmed = sources.relay === "reel" && vaultOrigin === "non-confirme";
  const stale = [
    isStale(relay, now) ? NAMES.relay : null,
    isStale(vault, now) ? NAMES.vault : null,
    isStale(response, now) ? NAMES.response : null,
  ].filter((name) => name !== null);
  const queueStuck = sameWorld(sources) && relay.data !== null && response.data !== null && relayUnavailable(response.data.journal, relay.data.queue);
  const vaultPaused = relay.data !== null && chainVaultPaused(relay.data.events);
  return (
    <div className="bandeaux">
      {/* Permanent en mode faux coffre : rien de ce qui suit ne vient d'un vrai coffre. */}
      {fake && (
        <p className="bandeau bandeau-simule" role="note" data-testid="bandeau-coffre-simule">
          <strong>COFFRE SIMULÉ : aucun fonds, aucune chaîne</strong>. Décisions, montants et plaçable viennent d'un faux coffre en mémoire
          dans le relais.
        </p>
      )}
      {unconfirmed && (
        <p className="bandeau bandeau-simule" role="note" data-testid="bandeau-coffre-non-confirme">
          <strong>Origine du coffre non confirmée</strong> : le proxy local n'a pas dit si le relais lit un contrat ou un faux coffre. Ne
          lisez pas ces montants comme ceux d'un coffre réel.
        </p>
      )}
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
          <strong>Coffre en pause</strong>
          {fake ? " (faux coffre)" : " sur la chaîne"} : aucune sortie tant que le propriétaire ne l'a pas levée.
        </p>
      )}
    </div>
  );
}
