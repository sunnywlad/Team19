// Échéance d'un cas en attente : les trois états, les bornes du dernier quart
// et de l'échéance, le pas d'affichage, et les jalons qui n'existent que si
// l'API les fournit.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../src/api/types.ts";
import { Echeance } from "../src/components/veto/Echeance.tsx";
import { approverAlertAt } from "../src/domain/activity.ts";
import { deadlineView, displayStep, formatHoursMinutes, formatWindow } from "../src/domain/echeance.ts";
import { text } from "./helpers.tsx";

const DAY = 86_400;
const T0 = 1_800_000_000; // bloc de la décision 1, en secondes

describe("échéance : calcul", () => {
  it("temps restant en heures et minutes, jamais en secondes", () => {
    expect(formatHoursMinutes(20 * 3600 + 12 * 60 + 59)).toBe("20 h 12");
    expect(formatHoursMinutes(3 * 3600 + 5 * 60)).toBe("3 h 05");
    expect(formatHoursMinutes(3600)).toBe("1 h 00");
    expect(formatHoursMinutes(3599)).toBe("59 min");
    expect(formatHoursMinutes(60)).toBe("1 min");
    expect(formatHoursMinutes(59)).toBe("moins d'1 min");
    expect(formatHoursMinutes(-5)).toBe("moins d'1 min");
  });

  it("durée du délai, telle qu'elle est", () => {
    expect([30, 600, 3600, 5400, DAY].map(formatWindow)).toEqual(["30 s", "10 min", "1 h", "1 h 30", "24 h"]);
  });

  it("pas d'affichage : la minute pour un délai réel, une case pour un délai court", () => {
    expect(displayStep(DAY)).toBe(60);
    expect(displayStep(24 * 60)).toBe(60);
    expect(displayStep(600)).toBe(25);
    expect(displayStep(30)).toBe(1);
    expect(displayStep(10)).toBe(1);
  });

  it("une case vaut 1/24 du délai", () => {
    expect(deadlineView(T0 + DAY, T0, T0)).toEqual({ state: "normal", remainingS: DAY, casesOn: 24, windowS: DAY });
    // 3 h 48 écoulées : 20 h 12 restantes, 20 cases pleines, comme la maquette.
    expect(deadlineView(T0 + DAY, T0, T0 + 3 * 3600 + 48 * 60)).toMatchObject({ state: "normal", remainingS: 20 * 3600 + 12 * 60, casesOn: 20 });
  });

  it("dernier quart : normal juste avant, proche à partir de la borne", () => {
    const quarter = T0 + (DAY * 3) / 4;
    expect(deadlineView(T0 + DAY, T0, quarter - 60)?.state).toBe("normal");
    expect(deadlineView(T0 + DAY, T0, quarter)).toMatchObject({ state: "proche", casesOn: 6 });
  });

  it("échéance : proche une seconde avant, échue à l'échéance, sans attendre le pas d'affichage", () => {
    expect(deadlineView(T0 + DAY, T0, T0 + DAY - 1)).toMatchObject({ state: "proche", casesOn: 0 });
    expect(deadlineView(T0 + DAY, T0, T0 + DAY)).toEqual({ state: "echue", remainingS: 0, casesOn: 0, windowS: DAY });
    expect(deadlineView(T0 + DAY, T0, T0 + DAY + 3600)?.state).toBe("echue");
  });

  it("rafraîchi à la minute : entre deux minutes, rien ne change", () => {
    const at = (offset: number) => deadlineView(T0 + DAY, T0, T0 + offset);
    expect(at(600)).toEqual(at(659));
    expect(at(660)).not.toEqual(at(659));
  });

  it("borne manquante ou fenêtre vide : rien à afficher", () => {
    expect(deadlineView(null, T0, T0)).toBeNull();
    expect(deadlineView(T0, T0, T0)).toBeNull();
    expect(deadlineView(T0 - 5, T0, T0)).toBeNull();
  });
});

describe("échéance : rendu", () => {
  const at = (id: string): string => text(screen.getByTestId(id));

  it("normal : temps, date écrite, 24 cases, règle, et les deux jalons du contrat", () => {
    render(<Echeance deadline={T0 + DAY} decidedAt={T0} now={(T0 + 3 * 3600 + 48 * 60) * 1000} />);
    const root = screen.getByTestId("echeance");
    expect(root.getAttribute("data-etat")).toBe("normal");
    expect(at("echeance-temps")).toBe("20 h 12");
    expect(text(root)).toMatch(/Échéance \S+ \d{1,2} \S+,? \d{2}:\d{2}/);
    expect(text(root)).toContain("restantes · délai de 24 h");
    expect(root.querySelectorAll(".segments i")).toHaveLength(24);
    expect(root.querySelectorAll(".segments i.on")).toHaveLength(20);
    expect(at("echeance-phrase")).toBe("Sans signature avant l'échéance : refusé.");
    expect([...screen.getByTestId("echeance-jalons").children].map((li) => text(li.children[1] as Element))).toEqual([
      "Mise en attente par le contrat",
      "Sans signature : refusé (APPROVAL_TIMEOUT)",
    ]);
  });

  it("proche : dit en toutes lettres ; échue : toutes les cases en pointillé", () => {
    const view = render(<Echeance deadline={T0 + DAY} decidedAt={T0} now={(T0 + DAY - 3 * 3600 - 5 * 60) * 1000} />);
    expect(at("echeance-temps")).toBe("3 h 05");
    expect(at("echeance-proche")).toBe("Échéance proche");
    view.unmount();

    render(<Echeance deadline={T0 + DAY} decidedAt={T0} now={(T0 + DAY + 10) * 1000} />);
    expect(screen.getByTestId("echeance").getAttribute("data-etat")).toBe("echue");
    expect(at("echeance-temps")).toBe("Échéance dépassée");
    expect(document.querySelectorAll(".segments i.echue")).toHaveLength(24);
    expect(at("echeance-phrase")).toContain("Le montant reste bloqué tant que l'expiration n'est pas constatée sur la chaîne.");
  });

  it("échéance non lue : dite comme telle, sans jauge inventée", () => {
    render(<Echeance deadline={null} decidedAt={T0} now={T0 * 1000} />);
    expect(screen.getByTestId("echeance").getAttribute("data-etat")).toBe("non-disponible");
    expect(at("echeance-temps")).toBe("Échéance non disponible");
    expect(document.querySelectorAll(".segments")).toHaveLength(0);
  });

  it("variante compacte : temps et jauge, sans jalons", () => {
    render(<Echeance deadline={T0 + DAY} decidedAt={T0} now={T0 * 1000} compact />);
    expect(document.querySelectorAll(".segments i.on")).toHaveLength(24);
    expect(screen.queryByTestId("echeance-jalons")).toBeNull();
  });
});

describe("échéance : jalons fournis par l'API seulement", () => {
  const entry = (type: string, requestId: string, data: Record<string, unknown>, ts: number): JournalEntry => ({
    v: 1,
    seq: ts,
    ts_ms: ts,
    type,
    component: "RESPONSE",
    request_id: requestId,
    agent_id: null,
    client_id: null,
    data,
    prev_hash: "0x00",
    hash: "0x01",
  });

  it("l'alerte à l'approbateur n'est lue que dans le journal, pour la bonne demande", () => {
    const journal = [
      entry("ALERT_SENT", "0xaa", { kind: "SECURITY" }, 10),
      entry("ALERT_SENT", "0xbb", { kind: "APPROVAL_REQUESTED" }, 20),
      entry("ALERT_SENT", "0xaa", { kind: "APPROVAL_REQUESTED" }, 30),
    ];
    expect(approverAlertAt("0xaa", journal)).toBe(30);
    expect(approverAlertAt("0xcc", journal)).toBeNull();
    expect(approverAlertAt("0xaa", [])).toBeNull();
  });

  it("sans alerte fournie : la ligne n'existe pas ; aucun rappel n'est jamais affiché", () => {
    const view = render(<Echeance deadline={T0 + DAY} decidedAt={T0} now={T0 * 1000} />);
    expect(screen.queryByTestId("jalon-alerte")).toBeNull();
    expect(text(screen.getByTestId("echeance"))).not.toMatch(/rappel|notification/i);
    view.unmount();

    render(<Echeance deadline={T0 + DAY} decidedAt={T0} now={T0 * 1000} notifiedAtMs={(T0 + 2) * 1000} />);
    expect(text(screen.getByTestId("jalon-alerte"))).toContain("Alerte à l'approbateur écrite au journal");
    expect(text(screen.getByTestId("echeance"))).not.toMatch(/rappel/i);
  });
});
