import type { ReactNode } from "react";
import type { Treasury } from "../../domain/tresorerie.ts";
import { DEFAULT_UNITE, formatWei } from "../../lib/format.ts";
import { Icon, type GlyphName } from "./glyphs.tsx";

type Status = "sain" | "attention" | "alerte" | "neutre";
const STATUS_GLYPHS: Partial<Record<Status, GlyphName>> = { sain: "coche", attention: "sablier", alerte: "quarantaine" };

function Cell({ label, value, status, note, testId }: { label: string; value: ReactNode; status: Status; note: string; testId: string }) {
  const glyph = STATUS_GLYPHS[status];
  return (
    <div data-testid={testId}>
      <span className="veto-etiquette">{label}</span>
      <span className="veto-chiffre">{value}</span>
      <span className={`veto-statut veto-statut-${status}`}>
        {glyph && <Icon name={glyph} small />}
        {note}
      </span>
    </div>
  );
}

const NOT_MEASURED = <span className="indisponible">Non mesuré</span>;

function amount(wei: string | null): ReactNode {
  const text = formatWei(wei);
  if (text === null) return NOT_MEASURED;
  return (
    <>
      {text}
      <small>{DEFAULT_UNITE.symbole}</small>
    </>
  );
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * Bandeau de trésorerie : montant sorti, montant bloqué, agents en pause, coffre
 * en pause ou non. Il montre des montants et des états lus, chacun avec son mot ;
 * il ne dit jamais que l'argent est « en sécurité ». `stale` : lecture trop
 * ancienne, les valeurs restent lisibles mais grisées.
 */
export function BandeauTresorerie({ treasury, stale = false }: { treasury: Treasury; stale?: boolean }) {
  const { paidWei, paidCount, heldWei, pausedAgents, vaultPaused } = treasury;
  const held = formatWei(heldWei);
  return (
    <section className={stale ? "bandeau-tresor perime" : "bandeau-tresor"} aria-label="Situation de la trésorerie" data-testid="bandeau-tresorerie" data-perime={stale ? "true" : "false"}>
      <Cell
        testId="tresor-sorti"
        label="Montant sorti"
        value={amount(paidWei)}
        status={paidCount === null || paidWei === null ? "neutre" : "sain"}
        note={
          paidCount === null
            ? "Événements du relais non lus"
            : paidWei === null
              ? "Un montant payé est illisible"
              : paidCount === 0
                ? "Aucun paiement lu"
                : `${paidCount} ${plural(paidCount, "paiement lu", "paiements lus")}, sur réseau de test`
        }
      />
      <Cell
        testId="tresor-bloque"
        label="Montant bloqué"
        value={amount(heldWei)}
        status={held === null ? "neutre" : heldWei === "0" ? "sain" : "attention"}
        note={held === null ? "Coffre non lu" : heldWei === "0" ? "Rien n'attend un humain" : "En attente d'un humain"}
      />
      <Cell
        testId="tresor-agents"
        label="Agents en pause"
        value={pausedAgents === null ? NOT_MEASURED : pausedAgents}
        status={pausedAgents === null ? "neutre" : pausedAgents === 0 ? "sain" : "alerte"}
        note={pausedAgents === null ? "Service de réponse non lu" : pausedAgents === 0 ? "Aucun agent écarté" : `${plural(pausedAgents, "Écarté", "Écartés")} par le service de réponse`}
      />
      <Cell
        testId="tresor-coffre"
        label="Coffre"
        value={vaultPaused === null ? NOT_MEASURED : vaultPaused ? "En pause" : "Actif"}
        status={vaultPaused === null ? "neutre" : vaultPaused ? "alerte" : "sain"}
        note={vaultPaused === null ? "Coffre non lu" : vaultPaused ? "Aucune sortie possible" : "Non en pause"}
      />
    </section>
  );
}
