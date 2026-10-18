// Recherche de la barre haute : un filtre local sur ce que la console a déjà
// lu (fournisseurs, factures et agents inscrits) et sur le référentiel de
// libellés. Aucune requête réseau, aucune URL : la saisie ne quitte pas la page.
import type { Libelle, RelayEvent } from "../api/types.ts";
import { abbreviateId } from "../lib/format.ts";

export type Trouvaille = {
  id: string;
  genre: "beneficiaire" | "facture" | "agent";
  /** Libellé du référentiel, ou identifiant abrégé. */
  nom: string;
  sous: string | null;
  /** Fournisseur de la facture, s'il est inscrit. */
  beneficiaryId: string | null;
  /** Texte normalisé sur lequel la saisie est cherchée. */
  cle: string;
};

/** Minuscules, sans accents ni espaces : « Bellec », « bellec » et « 812447905 » se trouvent. */
export function normaliser(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, "");
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Ce qui se cherche : chaque fournisseur, facture et agent inscrit, avec son libellé s'il en a un. */
export function trouvailles(events: RelayEvent[], libelles: ReadonlyMap<string, Libelle>): Trouvaille[] {
  const out = new Map<string, Trouvaille>();
  const add = (id: string | null, genre: Trouvaille["genre"], beneficiaryId: string | null = null): void => {
    if (id === null || out.has(id)) return;
    const label = libelles.get(id);
    const own = label && label.genre === genre ? label : undefined;
    const nom = own?.libelle ?? abbreviateId(id) ?? "valeur hors format";
    const sous = own?.sous_titre ?? own?.detail ?? null;
    const cle = normaliser([nom, sous, own?.siren, own?.iban_masque, id, abbreviateId(id)].filter((v) => v).join("|"));
    out.set(id, { id, genre, nom, sous, beneficiaryId, cle });
  };
  for (const e of events) {
    if (e.name === "BeneficiaryRegistered") add(str(e.args.beneficiaryId), "beneficiaire");
    else if (e.name === "InvoiceRegistered") add(str(e.args.invoiceId), "facture", str(e.args.beneficiaryId));
    else if (e.name === "AgentRegistered") add(str(e.args.agentId), "agent");
  }
  return [...out.values()];
}

/** Trouvailles qui contiennent la saisie, fournisseurs d'abord. Saisie vide : rien. */
export function rechercher(items: Trouvaille[], query: string, max = 8): Trouvaille[] {
  const q = normaliser(query);
  if (q === "") return [];
  const order = { beneficiaire: 0, facture: 1, agent: 2 } as const;
  return items.filter((i) => i.cle.includes(q)).sort((a, b) => order[a.genre] - order[b.genre] || a.nom.localeCompare(b.nom, "fr")).slice(0, max);
}

/** Fournisseurs retenus par la saisie : nommés eux-mêmes, ou dont une facture l'est. null : aucun filtre. */
export function fournisseursRetenus(items: Trouvaille[], query: string): Set<string> | null {
  const q = normaliser(query);
  if (q === "") return null;
  const kept = new Set<string>();
  for (const i of items) {
    if (!i.cle.includes(q)) continue;
    if (i.genre === "beneficiaire") kept.add(i.id);
    else if (i.genre === "facture" && i.beneficiaryId !== null) kept.add(i.beneficiaryId);
  }
  return kept;
}

/** Agents retenus par la saisie. null : aucun filtre. */
export function agentsRetenus(items: Trouvaille[], query: string): Set<string> | null {
  const q = normaliser(query);
  if (q === "") return null;
  return new Set(items.filter((i) => i.genre === "agent" && i.cle.includes(q)).map((i) => i.id));
}
