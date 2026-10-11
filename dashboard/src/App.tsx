import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ApiClient } from "./api/client.ts";
import { Banners, Freshness } from "./components/Banners.tsx";
import { loadRelay, loadResponse } from "./data/load.ts";
import { useNow, usePolled } from "./hooks/usePolled.ts";
import { THEME_LABELS, useTheme } from "./hooks/useTheme.ts";
import { UNIT_LEGEND } from "./lib/format.ts";
import { DecisionsView } from "./views/DecisionsView.tsx";
import { IncidentView } from "./views/IncidentView.tsx";
import { JournalView } from "./views/JournalView.tsx";
import { PendingView } from "./views/PendingView.tsx";
import type { ViewProps } from "./views/shared.ts";

const VIEWS = [
  { key: "decisions", label: "Décisions" },
  { key: "incident", label: "Incident" },
  { key: "journal", label: "Journal" },
  { key: "attente", label: "En attente" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

/** L'écran vient de l'ancre de l'adresse, comparée à une liste fermée. */
function viewFromHash(): ViewKey {
  const wanted = window.location.hash.replace(/^#/, "");
  return VIEWS.find((v) => v.key === wanted)?.key ?? "decisions";
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
  useEffect(() => {
    const onHash = (): void => setCurrent(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const show = (key: ViewKey): void => {
    setCurrent(key);
    window.history.replaceState(null, "", `#${key}`);
  };

  const [theme, nextTheme] = useTheme();
  const main = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLElement>(null);

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
    const view = VIEWS[target];
    if (!view) return;
    event.preventDefault();
    show(view.key);
    tabs.current?.querySelectorAll("button")[target]?.focus();
  };

  return (
    <div className="page">
      <button type="button" className="evitement" data-ui="navigation" onClick={() => main.current?.focus()}>
        Aller au contenu
      </button>
      <header className="entete">
        <div className="entete-titre">
          <h1>Argent Intelligent</h1>
          <p className="lecture-seule">Tableau de bord en lecture seule</p>
        </div>
        <Freshness view={view} />
        <button type="button" className="theme" data-ui="affichage" onClick={nextTheme}>
          Thème : {THEME_LABELS[theme]}
        </button>
      </header>
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
      <Banners view={view} />
      <main id="contenu" ref={main} tabIndex={-1} aria-label={VIEWS.find((v) => v.key === current)?.label}>
        {current === "decisions" && <DecisionsView view={view} />}
        {current === "incident" && <IncidentView view={view} />}
        {current === "journal" && <JournalView view={view} />}
        {current === "attente" && <PendingView view={view} />}
      </main>
      <footer className="pied">
        <p>
          Cette page n'émet que des lectures (GET) : elle ne peut ni payer, ni mettre en pause, ni approuver. Identifiants opaques abrégés,
          aucune donnée nominative. {UNIT_LEGEND}.
        </p>
      </footer>
    </div>
  );
}
