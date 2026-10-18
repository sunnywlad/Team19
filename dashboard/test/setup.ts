import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// React vérifie ce drapeau avant d'accepter act() hors de son propre banc.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // L'écran courant vit dans l'ancre de l'adresse : chaque test repart de la vue d'ensemble.
  window.history.replaceState(null, "", "/");
});
