// Parcours complet de l'interface, partagé par les tests : chaque écran, puis
// chaque bouton qui ne fait que changer ce qu'on regarde.
import { fireEvent, screen } from "@testing-library/react";

export const SCREENS = ["Accueil", "Validation", "Alertes et rapports", "Rôles"] as const;

export function open(name: (typeof SCREENS)[number]): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

export async function tour(): Promise<void> {
  for (const name of SCREENS) {
    open(name);
    await screen.findByRole("button", { name, current: "page" });
    for (const button of screen.queryAllByRole("button", { pressed: false })) fireEvent.click(button);
  }
  fireEvent.click(screen.getByRole("button", { name: "Aller au contenu" }));
  open("Accueil");
}
