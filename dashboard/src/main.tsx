import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RealApiClient, SimulatedApiClient } from "./api/client.ts";
import { App } from "./App.tsx";
import "./styles.css";

// Injecté par vite.config.ts. Ce ne sont que des drapeaux : les URLs et un
// éventuel jeton restent dans le proxy local, côté serveur.
declare const __DASHBOARD_CONFIG__: { mode: "reel" | "simulation"; vaultFromRelay: boolean; responseAvailable: boolean };

const config = __DASHBOARD_CONFIG__;
const client =
  config.mode === "simulation"
    ? new SimulatedApiClient()
    : new RealApiClient({ vaultFromRelay: config.vaultFromRelay, responseAvailable: config.responseAvailable });

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App client={client} />
    </StrictMode>,
  );
}
