import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ApiClient } from "./api/client.ts";
import { Banners, Freshness } from "./components/Banners.tsx";
import { VetoMark } from "./components/icons.tsx";
import { RoundTablePanel } from "./components/RoundTablePanel.tsx";
import { loadRelay, loadResponse } from "./data/load.ts";
import { useNow, usePolled } from "./hooks/usePolled.ts";
import { UNIT_LEGEND } from "./lib/format.ts";
import { HomeView } from "./views/HomeView.tsx";
import { IncidentView } from "./views/IncidentView.tsx";
import { PendingView } from "./views/PendingView.tsx";
import { RolesView } from "./views/RolesView.tsx";
import { PresentationView } from "./views/PresentationView.tsx";
import type { ViewProps } from "./views/shared.ts";

export const VIEWS = [
  { key: "accueil", label: "Accueil" },
  { key: "validation", label: "Validation" },
  { key: "alertes", label: "Alertes et rapports" },
  { key: "roles", label: "Rôles" },
  { key: "presentation", label: "Présentation" },
] as const;
export type ViewKey = (typeof VIEWS)[number]["key"];

/** L'écran vient de l'ancre de l'adresse, comparée à une liste fermée. Sans ancre connue : l'accueil. */
function viewFromHash(): ViewKey {
  const wanted = window.location.hash.replace(/^#/, "");
  return VIEWS.find((v) => v.key === wanted)?.key ?? "accueil";
}

/** Le dashboard : il lit, il n'agit pas. Aucun bouton ici ne déclenche un paiement, une pause ou une approbation. */
export function App({ client }: { client: ApiClient }) {
  const relay = usePolled(useCallback((signal: AbortSignal) => loadRelay(client, signal), [client]));
  const vault = usePolled(useCallback((signal: AbortSignal) => client.getVaultState(signal), [client]));
  const response = usePolled(useCallback((signal: AbortSignal) => loadResponse(client, signal), [client]));
  const origin = usePolled(useCallback((signal: AbortSignal) => client.getVaultOrigin(signal), [client]));
  const now = useNow();
  // Sans réponse du proxy local, l'origine du coffre n'est pas confirmée : jamais « chaîne » par défaut.
  const vaultOrigin = origin.data ?? (origin.error === null ? "lecture" : "non-confirme");
  const view: ViewProps = { relay, vault, response, sources: client.sources, vaultOrigin, now };

  const [current, setCurrent] = useState<ViewKey>(viewFromHash);
  /** Incident à ouvrir sur la page « Alertes et rapports », choisi depuis l'accueil. */
  const [incident, setIncident] = useState<string | null>(null);
  /** Demande montée à la table ronde. null : la page choisit (attente humaine d'abord). */
  const [request, setRequest] = useState<string | null>(null);
  useEffect(() => {
    const onHash = (): void => setCurrent(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const main = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLElement>(null);
  const show = (key: ViewKey): void => {
    setCurrent(key);
    window.history.replaceState(null, "", `#${key}`);
  };
  /** Changement de page depuis le contenu : le clavier suit, en haut de la nouvelle page. */
  const go = (key: ViewKey): void => {
    show(key);
    main.current?.focus();
  };

  /** Flèches, Début et Fin passent d'un écran à l'autre, comme dans une barre d'onglets. */
  const onTabKey = (event: KeyboardEvent<HTMLElement>): void => {
    const index = VIEWS.findIndex((v) => v.key === current);
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % VIEWS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + VIEWS.length) % VIEWS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? VIEWS.length - 1
              : -1;
    const next = VIEWS[target];
    if (!next) return;
    event.preventDefault();
    show(next.key);
    tabs.current?.querySelectorAll("button")[target]?.focus();
  };

  return (
    <div className="page">
      <button type="button" className="evitement" data-ui="navigation" onClick={() => main.current?.focus()}>
        Aller au contenu
      </button>
      <header className="entete">
        <div className="cadre entete-haut">
          <div className="marque">
            <VetoMark />
            <div>
              <h1>Veto</h1>
              <p className="marque-sous">Argent Intelligent</p>
            </div>
            <p className="lecture-seule">lecture seule</p>
          </div>
          <Freshness view={view} />
        </div>
        <div className="cadre entete-bas">
          <nav className="onglets" aria-label="Écrans" ref={tabs} onKeyDown={onTabKey}>
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                data-ui="navigation"
                aria-current={current === v.key ? "page" : undefined}
                // Une seule étape de tabulation pour la barre : les flèches font le reste.
                tabIndex={current === v.key ? 0 : -1}
                onClick={() => show(v.key)}
              >
                {v.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <div className="cadre contenu">
        <Banners view={view} />
        <main id="contenu" ref={main} tabIndex={-1} aria-label={VIEWS.find((v) => v.key === current)?.label}>
          {current === "accueil" && (
            <HomeView
              view={view}
              onOpenValidation={() => go("validation")}
              table={<RoundTablePanel view={view} selected={request} onSelect={setRequest} />}
              onShow={(id) => {
                setRequest(id);
                document.getElementById("titre-table")?.scrollIntoView?.({ block: "start" });
              }}
              onOpenIncident={(id) => {
                setIncident(id);
                go("alertes");
              }}
            />
          )}
          {current === "validation" && <PendingView view={view} />}
          {current === "alertes" && <IncidentView view={view} initialIncident={incident} />}
          {current === "roles" && <RolesView view={view} />}
          {current === "presentation" && <PresentationView />}
        </main>
      </div>
      <footer className="cadre pied">
        <p className="pied-mention" data-testid="pied-mention">
          Données fictives · réseau de test
        </p>
        <p>
          Cette page n'émet que des lectures (GET) : elle ne peut ni payer, ni mettre en pause, ni approuver. Identifiants opaques abrégés,
          aucune donnée nominative. {UNIT_LEGEND}.
        </p>
      </footer>
    </div>
  );
}
