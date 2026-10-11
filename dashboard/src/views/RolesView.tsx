// Rôles : qui détient quel pouvoir, et le mandat de chaque agent. Lecture
// seule ; ce qu'aucune API ne sert est écrit « non disponible ».
import { OpaqueId } from "../components/atoms.tsx";
import { Icon } from "../components/icons.tsx";
import { Panel } from "../components/Panel.tsx";
import { agentMandates, CONTRACT_ROLES } from "../domain/roles.ts";
import { vaultFed, type ViewProps } from "./shared.ts";

export function RolesView({ view }: { view: ViewProps }) {
  const { relay, sources, vaultOrigin, now } = view;
  return (
    <>
      <section className="panneau" aria-labelledby="titre-roles">
        <header className="panneau-entete">
          <h2 id="titre-roles">Rôles du contrat</h2>
          <span className="source source-simulation" title="Recopié de l'interface gelée, pas lu dans une API">
            interface gelée
          </span>
        </header>
        <p className="discret">
          Pouvoirs recopiés de <code>specs/contract/IArgentVault.sol</code>. L'adresse qui détient chaque rôle n'est servie par aucune API lue
          ici : non disponible. Le dashboard, lui, ne détient aucune clé.
        </p>
        <div className="defilement" role="region" aria-label="Rôles du contrat" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Rôle</th>
                <th scope="col">Pouvoir</th>
                <th scope="col">Limite</th>
                <th scope="col">Détenu par</th>
              </tr>
            </thead>
            <tbody>
              {CONTRACT_ROLES.map((r) => (
                <tr key={r.key} data-testid="role">
                  <th scope="row">
                    <Icon name="cle" /> {r.label}
                  </th>
                  <td data-label="Pouvoir">{r.powers}</td>
                  <td data-label="Limite" className="discret">
                    {r.limit}
                  </td>
                  <td data-label="Détenu par">
                    <span className="indisponible">non disponible</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Panel title="Mandats des agents" id="titre-mandats" source={vaultFed(sources.relay, vaultOrigin)} snapshot={relay} now={now}>
        {(data) => {
          const agents = agentMandates(data.events);
          if (agents.length === 0) return <p className="vide">Aucun agent inscrit dans les événements lus : mandats non disponibles.</p>;
          return (
            <>
              <p className="discret">
                Lus dans les événements <code>AgentRegistered</code> et <code>AgentPaused</code>. Un mandat à 0 : agent connu, sans droit d'action.
              </p>
              <ul className="liste-lignes">
                {agents.map((a) => (
                  <li key={a.agentId} data-testid="mandat">
                    <p>
                      Agent <OpaqueId value={a.agentId} />{" "}
                      {a.paused && (
                        <span className="mot-veto">
                          <Icon name="pause" /> en pause sur la chaîne
                        </span>
                      )}
                    </p>
                    <p className="discret">
                      {a.mandate === null
                        ? "mandat illisible"
                        : a.actions.length === 0
                          ? "aucun droit d'action"
                          : a.actions.join(" · ")}
                      {a.unknownBits && " · bits de mandat inconnus, ignorés"} · inscrit au bloc {a.blockNumber}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </Panel>
    </>
  );
}
