// Parcours complet de l'interface, partagé par les tests : chaque écran, puis
// chaque bouton non pressé qu'il propose.
import { fireEvent, screen } from "@testing-library/react";

export const SCREENS = ["Vue d'ensemble", "À valider", "Incidents", "Fournisseurs", "Agents", "Règles", "Piste d'audit", "Campagne"] as const;
export type ScreenName = (typeof SCREENS)[number];

/** Nom accessible d'un lien de la barre latérale : son libellé, suivi éventuellement du compteur (« À valider, 1 en attente »). */
export const navName = (name: ScreenName): RegExp => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(,|$)`);

export function open(name: ScreenName): void {
  fireEvent.click(screen.getByRole("button", { name: navName(name) }));
}

export async function tour(): Promise<void> {
  for (const name of SCREENS) {
    open(name);
    await screen.findByRole("button", { name: navName(name), current: "page" });
    for (const button of screen.queryAllByRole("button", { pressed: false })) fireEvent.click(button);
  }
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: /^Thème/ }));
  fireEvent.click(screen.getByRole("button", { name: "Aller au contenu" }));
  open("Vue d'ensemble");
}
