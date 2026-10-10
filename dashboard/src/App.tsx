import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "./api/client.ts";
import { Banners, Freshness } from "./components/Banners.tsx";
import { loadRelay, loadResponse } from "./data/load.ts";
import { useNow, usePolled } from "./hooks/usePolled.ts";
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
  const now = useNow();
  const view: ViewProps = { relay, vault, response, sources: client.sources, now };

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

  return (
    <div className="page">
      <header className="entete">
        <div className="entete-titre">
          <h1>Argent Intelligent</h1>
          <p className="lecture-seule">Tableau de bord en lecture seule</p>
        </div>
        <Freshness {...view} />
      </header>
      <nav className="onglets" aria-label="Écrans">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" data-nav="true" aria-current={current === v.key ? "page" : undefined} onClick={() => show(v.key)}>
            {v.label}
          </button>
        ))}
      </nav>
      <Banners {...view} />
      <main id="contenu">
        {current === "decisions" && <DecisionsView {...view} />}
        {current === "incident" && <IncidentView {...view} />}
        {current === "journal" && <JournalView {...view} />}
        {current === "attente" && <PendingView {...view} />}
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
