import type { VaultState } from "../api/types.ts";
import { useAffichage } from "../hooks/useAffichage.ts";
import { formatTime, unitLegend } from "../lib/format.ts";
import { Amount } from "./atoms.tsx";
import { PlaceableBar } from "./PlaceableBar.tsx";
import { Rolling } from "./Rolling.tsx";

/**
 * Montant plaçable et ses termes, tels que les vues du contrat les renvoient.
 * Aucun calcul ici : si « placeable » manque, la page dit « non disponible »
 * plutôt que de le déduire des autres termes.
 */
export function PlaceableValues({ vault, simulated = false }: { vault: VaultState; simulated?: boolean }) {
  const { unite } = useAffichage();
  return (
    <>
      <p className="placable" data-testid="placable">
        <Rolling value={vault.placeable_wei}>
          <Amount wei={vault.placeable_wei} />
        </Rolling>
      </p>
      <p className="formule">plaçable = cash − dettes admises − réserve de sécurité − placements bloqués (jamais négatif)</p>
      <PlaceableBar vault={vault} />
      <dl className="termes">
        <div>
          <dt>Cash</dt>
          <dd data-testid="cash">
            <Rolling value={vault.cash_wei}>
              <Amount wei={vault.cash_wei} />
            </Rolling>
          </dd>
        </div>
        <div>
          <dt>− Dettes admises</dt>
          <dd data-testid="dettes">
            <Rolling value={vault.admitted_debts_wei}>
              <Amount wei={vault.admitted_debts_wei} />
            </Rolling>
          </dd>
        </div>
        <div>
          <dt>− Réserve de sécurité</dt>
          <dd data-testid="reserve">
            <Rolling value={vault.safety_reserve_wei}>
              <Amount wei={vault.safety_reserve_wei} />
            </Rolling>
          </dd>
        </div>
        <div>
          <dt>− Placements bloqués</dt>
          <dd data-testid="placements-bloques">
            <Rolling value={vault.held_placements_wei}>
              <Amount wei={vault.held_placements_wei} />
            </Rolling>
          </dd>
        </div>
        <div>
          <dt>Montant bloqué (cas en attente)</dt>
          <dd data-testid="bloque">
            <Rolling value={vault.total_held_wei}>
              <Amount wei={vault.total_held_wei} />
            </Rolling>
          </dd>
        </div>
      </dl>
      <p className="discret" data-testid="placable-origine">
        {simulated
          ? `Valeurs d'un faux coffre en mémoire dans le relais (bloc simulé ${vault.block_number}, ${formatTime(vault.block_timestamp * 1000)}) : aucun fonds, aucune chaîne.`
          : `Valeurs lues dans le contrat au bloc ${vault.block_number} (${formatTime(vault.block_timestamp * 1000)}, horloge du bloc).`}{" "}
        Aucun recalcul dans l'interface. Une facture bloquée reste une dette admise : elle n'est pas déduite deux fois. {unitLegend(unite)}.
      </p>
      {vault.vault_paused === true && (
        <p className="alerte-ligne" role="status">
          Coffre en pause : aucune sortie.
        </p>
      )}
    </>
  );
}
