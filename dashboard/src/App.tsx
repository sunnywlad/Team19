import { useCallback } from "react";
import type { ApiClient } from "./api/client.ts";
import { Banners, Freshness } from "./components/Banners.tsx";
import { loadRelay, loadResponse } from "./data/load.ts";
import { useNow, usePolled } from "./hooks/usePolled.ts";
import { UNIT_LEGEND } from "./lib/format.ts";
import { DecisionsView } from "./views/DecisionsView.tsx";
import type { ViewProps } from "./views/shared.ts";

/** Le dashboard : il lit, il n'agit pas. Aucun bouton ici ne déclenche un paiement, une pause ou une approbation. */
export function App({ client }: { client: ApiClient }) {
  const relay = usePolled(useCallback((signal: AbortSignal) => loadRelay(client, signal), [client]));
  const vault = usePolled(useCallback((signal: AbortSignal) => client.getVaultState(signal), [client]));
  const response = usePolled(useCallback((signal: AbortSignal) => loadResponse(client, signal), [client]));
  const now = useNow();
  const view: ViewProps = { relay, vault, response, sources: client.sources, now };

  return (
    <div className="page">
      <header className="entete">
        <div className="entete-titre">
          <h1>Argent Intelligent</h1>
          <p className="lecture-seule">Tableau de bord en lecture seule</p>
        </div>
        <Freshness {...view} />
      </header>
      <Banners {...view} />
      <main id="contenu">
        <DecisionsView {...view} />
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
