// Parcours complet de l'interface, partagé par les tests : chaque écran, puis
// chaque incident proposé.
import { fireEvent, screen } from "@testing-library/react";

export const SCREENS = ["Décisions", "Incident", "Journal", "En attente"] as const;

export function open(name: (typeof SCREENS)[number]): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

export async function tour(): Promise<void> {
  for (const name of SCREENS) {
    open(name);
    await screen.findByRole("button", { name, current: "page" });
    for (const button of screen.queryAllByRole("button", { pressed: false })) fireEvent.click(button);
  }
  open("Décisions");
}
