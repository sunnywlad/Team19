import { useId, useState, type KeyboardEvent } from "react";
import type { RelayEvent } from "../api/types.ts";
import { rechercher, trouvailles, type Trouvaille } from "../domain/recherche.ts";
import { useAffichage } from "../hooks/useAffichage.ts";
import { Icon } from "./icons.tsx";

const GENRE_MOTS: Record<Trouvaille["genre"], string> = { beneficiaire: "Fournisseur", facture: "Facture", agent: "Agent" };

/**
 * Recherche de la barre haute : fournisseurs, factures, agents. Filtre local sur
 * ce que la console a déjà lu ; rien ne part sur le réseau. Choisir une
 * trouvaille ouvre l'écran qui la montre, filtré sur la saisie.
 */
export function Recherche({
  events,
  query,
  onQuery,
  onPick,
}: {
  events: RelayEvent[] | null;
  query: string;
  onQuery: (q: string) => void;
  onPick: (item: Trouvaille) => void;
}) {
  const { libelles } = useAffichage();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const found = events === null ? [] : rechercher(trouvailles(events, libelles), query);
  const shown = open && query.trim() !== "";

  const pick = (item: Trouvaille): void => {
    onPick(item);
    setOpen(false);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (found.length > 0) setActive((i) => (i + (event.key === "ArrowDown" ? 1 : found.length - 1)) % found.length);
    } else if (event.key === "Enter") {
      const item = found[active] ?? found[0];
      if (item) pick(item);
    } else if (event.key === "Escape") {
      if (query !== "") onQuery("");
      setOpen(false);
    }
  };

  return (
    <div className="recherche-zone">
      <label className="recherche">
        <Icon name="loupe" />
        <input
          type="search"
          role="combobox"
          placeholder="Fournisseur, facture, agent…"
          aria-label="Rechercher un fournisseur, une facture ou un agent"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && found[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={60}
          value={query}
          data-testid="recherche"
          onChange={(e) => {
            onQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
      </label>
      <ul className="recherche-liste" id={listId} role="listbox" aria-label="Résultats" hidden={!shown} data-testid="recherche-resultats">
        {found.length === 0 ? (
          <li className="recherche-vide" role="option" aria-selected={false} aria-disabled="true">
            {events === null ? "Données pas encore lues." : "Aucun fournisseur, facture ou agent ne correspond."}
          </li>
        ) : (
          found.map((item, i) => (
            <li
              key={item.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="recherche-option"
              // mousedown : choisi avant que le champ perde le focus.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
            >
              <span className="recherche-genre">{GENRE_MOTS[item.genre]}</span>
              <span className="recherche-nom">{item.nom}</span>
              {item.sous !== null && <span className="recherche-sous">{item.sous}</span>}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
