import { useEffect, useId, useRef } from "react";
import type { Sources, TagSource, VaultOrigin } from "../api/types.ts";
import { chainVaultPaused, relayUnavailable } from "../domain/activity.ts";
import { useAffichage } from "../hooks/useAffichage.ts";
import { isStale, type Snapshot } from "../hooks/poller.ts";
import { formatTime, unitLegend } from "../lib/format.ts";
import { sameWorld, vaultFed, type ViewProps } from "../views/shared.ts";
import { FAMILLE_NOMS, SOURCE_MOTS, type Famille } from "./atoms.tsx";
import { Icon } from "./icons.tsx";

/**
 * Environnement de la console, dit une fois dans la barre haute :
 *   demo          tout vient du serveur de fixtures ;
 *   coffre-simule le relais est réel, mais il a un faux coffre en mémoire ;
 *   reseau-test   le relais lit un contrat, sur le réseau de test local ;
 *   non-confirme  le proxy n'a pas dit ce qu'il y a derrière le relais.
 * `partiel` : un point d'accès au moins reste simulé à côté d'un relais réel.
 */
export type Environnement = { kind: "demo" | "coffre-simule" | "reseau-test" | "non-confirme"; partiel: boolean };

export function environnementOf(sources: Sources, vaultOrigin: VaultOrigin): Environnement {
  if (sources.relay === "simulation") return { kind: "demo", partiel: false };
  const partiel = sources.vault === "simulation" || sources.response === "simulation";
  if (vaultOrigin === "faux-coffre") return { kind: "coffre-simule", partiel };
  if (vaultOrigin === "chaine") return { kind: "reseau-test", partiel };
  return { kind: "non-confirme", partiel };
}

const ENV_MOTS: Record<Environnement["kind"], string> = {
  demo: "Démo · données fictives",
  "coffre-simule": "Coffre simulé",
  "reseau-test": "Réseau de test",
  "non-confirme": "Origine non confirmée",
};

/** Ce que la puce ajoute, en clair, à côté de son mot. */
const ENV_PRECISIONS: Record<Environnement["kind"], string | null> = {
  demo: null,
  "coffre-simule": "aucun fonds, aucune chaîne",
  "reseau-test": null,
  "non-confirme": "ne lisez pas ces montants comme ceux d'un coffre réel",
};

/** Texte complet de l'environnement, pour le pied de page et les lecteurs d'écran. */
export function environnementTexte(env: Environnement): string {
  const precision = ENV_PRECISIONS[env.kind];
  return `${ENV_MOTS[env.kind]}${precision ? ` : ${precision}` : ""}${env.partiel ? " · en partie simulé" : ""}`;
}

const ORIGINES: Record<Famille, string> = {
  relay: "API en lecture seule du relais",
  vault: "vue du coffre (GET /vault)",
  response: "service de réponse : journal, incidents, pauses",
};

function provenanceOf(famille: Famille, sources: Sources, vaultOrigin: VaultOrigin): TagSource {
  // Tout ce que le coffre alimente suit son origine : jamais « réel » pour un faux coffre ou une origine non dite.
  if (famille === "vault") return vaultFed(sources.vault, vaultOrigin);
  if (famille === "relay") return sources.relay;
  return sources.response;
}

/**
 * La puce d'environnement et son panneau « Sources » : chaque famille de
 * données, son origine, sa dernière lecture réussie et sa fraîcheur. C'est ici
 * que la provenance se lit en entier ; chaque panneau y renvoie par son icône.
 */
export function EnvironnementPuce({ view, open, onToggle }: { view: ViewProps; open: boolean; onToggle: (next: boolean) => void }) {
  const { relay, vault, response, sources, vaultOrigin, now } = view;
  const { unite, uniteEtat, libellesEtat } = useAffichage();
  const env = environnementOf(sources, vaultOrigin);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const snapshots: Record<Famille, Snapshot<unknown>> = { relay, vault, response };
  const precision = ENV_PRECISIONS[env.kind];

  // Clic hors du panneau ou Échap : il se ferme, le focus revient à la puce.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) onToggle(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onToggle(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onToggle]);

  return (
    <div className="env" ref={root}>
      <button
        type="button"
        ref={button}
        className={`puce-env puce-env-${env.kind}`}
        data-ui="affichage"
        data-testid="puce-env"
        data-env={env.kind}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(!open)}
      >
        <Icon name={env.kind === "coffre-simule" || env.kind === "non-confirme" ? "doute" : "info"} />
        <span className="puce-env-mot">
          {ENV_MOTS[env.kind]}
          {precision && <span className="puce-env-precision"> : {precision}</span>}
          {env.partiel && <span className="puce-env-precision"> · en partie simulé</span>}
        </span>
        <span className="visuellement-cache">, voir les sources</span>
      </button>
      <div className="sources-panneau" id={panelId} role="dialog" aria-label="Sources" hidden={!open} data-testid="panneau-sources">
        <p className="sources-titre">Sources</p>
        <p className="sources-env">{environnementTexte(env)}</p>
        <ul className="fraicheur" aria-label="Dernière mise à jour par source">
          {(["relay", "vault", "response"] as const).map((famille) => {
            const snapshot = snapshots[famille];
            const stale = isStale(snapshot, now);
            const tag = provenanceOf(famille, sources, vaultOrigin);
            return (
              <li key={famille} className={stale ? "perime" : undefined} data-source={famille}>
                <span className="fraicheur-nom">{FAMILLE_NOMS[famille]}</span>
                <span className={`fraicheur-origine source-${tag === "reel" ? "reel" : "simulation"}`} data-provenance={tag}>
                  {SOURCE_MOTS[tag]}
                </span>
                <span className="fraicheur-detail">{ORIGINES[famille]}</span>
                <span className="fraicheur-heure" data-testid={`maj-${famille}`}>
                  {snapshot.lastOkAt === null ? "jamais lu" : `mis à jour à ${formatTime(snapshot.lastOkAt)}`}
                </span>
                <span className="fraicheur-etat">{snapshot.lastOkAt === null ? "aucune lecture réussie" : stale ? "périmé : plus de 10 s sans lecture" : "à jour"}</span>
              </li>
            );
          })}
        </ul>
        <p className="sources-note">
          Libellés : référentiel local{libellesEtat === "indisponible" ? " non lu, identifiants abrégés" : ""}, jamais envoyé au relais. Unité :{" "}
          {unitLegend(unite)}
          {uniteEtat === "indisponible" ? " (non déclarée par le proxy local : valeur par défaut)" : ""}.
        </p>
        <p className="sources-note">« Réel » n'est jamais une valeur par défaut : une origine que le proxy n'a pas dite reste « non confirmée ».</p>
      </div>
    </div>
  );
}

export function Banners({ view }: { view: ViewProps }) {
  const { relay, vault, response, sources, vaultOrigin, now } = view;
  const fake = sources.relay === "reel" && vaultOrigin === "faux-coffre";
  const stale = [
    isStale(relay, now) ? FAMILLE_NOMS.relay : null,
    isStale(vault, now) ? FAMILLE_NOMS.vault : null,
    isStale(response, now) ? FAMILLE_NOMS.response : null,
  ].filter((name) => name !== null);
  const queueStuck = sameWorld(sources) && relay.data !== null && response.data !== null && relayUnavailable(response.data.journal, relay.data.queue);
  const vaultPaused = relay.data !== null && chainVaultPaused(relay.data.events);
  // Le faux coffre et l'origine non confirmée sont dits par la puce de la barre haute, en permanence.
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
          <strong>Coffre en pause</strong>
          {fake ? " (faux coffre)" : " sur la chaîne"} : aucune sortie tant que le propriétaire ne l'a pas levée.
        </p>
      )}
    </div>
  );
}
