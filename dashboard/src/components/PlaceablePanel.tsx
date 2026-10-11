import type { VaultState } from "../api/types.ts";
import { UNIT_LEGEND, formatTime } from "../lib/format.ts";
import { Amount } from "./atoms.tsx";

/**
 * Montant plaçable et ses termes, tels que les vues du contrat les renvoient.
 * Aucun calcul ici : si « placeable » manque, la page dit « non disponible »
 * plutôt que de le déduire des autres termes.
 */
export function PlaceableValues({ vault, simulated = false }: { vault: VaultState; simulated?: boolean }) {
  return (
    <>
      <p className="placable" data-testid="placable">
        <Amount wei={vault.placeable_wei} />
      </p>
      <p className="formule">plaçable = cash − dettes admises − réserve de sécurité − placements bloqués (jamais négatif)</p>
      <dl className="termes">
        <div>
          <dt>Cash</dt>
          <dd data-testid="cash">
            <Amount wei={vault.cash_wei} />
          </dd>
        </div>
        <div>
          <dt>− Dettes admises</dt>
          <dd data-testid="dettes">
            <Amount wei={vault.admitted_debts_wei} />
          </dd>
        </div>
        <div>
          <dt>− Réserve de sécurité</dt>
          <dd data-testid="reserve">
            <Amount wei={vault.safety_reserve_wei} />
          </dd>
        </div>
        <div>
          <dt>− Placements bloqués</dt>
          <dd data-testid="placements-bloques">
            <Amount wei={vault.held_placements_wei} />
          </dd>
        </div>
        <div>
          <dt>Montant bloqué (cas en attente)</dt>
          <dd data-testid="bloque">
            <Amount wei={vault.total_held_wei} />
          </dd>
        </div>
      </dl>
      <p className="discret" data-testid="placable-origine">
        {simulated
          ? `Valeurs d'un faux coffre en mémoire dans le relais (bloc simulé ${vault.block_number}, ${formatTime(vault.block_timestamp * 1000)}) : aucun fonds, aucune chaîne.`
          : `Valeurs lues dans le contrat au bloc ${vault.block_number} (${formatTime(vault.block_timestamp * 1000)}, horloge du bloc).`}{" "}
        Aucun recalcul dans l'interface. Une facture bloquée reste une dette admise : elle n'est pas déduite deux fois. {UNIT_LEGEND}.
      </p>
      {vault.vault_paused === true && (
        <p className="alerte-ligne" role="status">
          Coffre en pause : aucune sortie.
        </p>
      )}
    </>
  );
}
