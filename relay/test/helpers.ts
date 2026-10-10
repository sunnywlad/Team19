import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPECS_DIR } from "../src/config.ts";
import type { Clock, Hex } from "../src/types.ts";

export function readSpecJson<T>(relative: string): T {
  return JSON.parse(readFileSync(join(SPECS_DIR, relative), "utf8")) as T;
}

export type Fixtures = {
  unit_wei: string;
  ids: Record<string, Hex>;
  vault: { cash_wei: string; safety_reserve_wei: string; threshold_wei: string; approval_delay_s: number };
  agents: { label: string; agent_id: Hex; mandate: ("PAY_INVOICE" | "PLACE")[] }[];
  beneficiaries: { label: string; beneficiary_id: Hex }[];
  invoices: { label: string; invoice_id: Hex; beneficiary: string | null; amount_wei: string | null; registered: boolean }[];
  placements: { label: string; placement_id: Hex; beneficiary: string; amount_wei: string }[];
};

export const fixtures = (): Fixtures => readSpecJson<Fixtures>("examples/fixtures.json");

/** Horloge de test : on l'avance à la main. */
export class ManualClock {
  ms: number;
  constructor(ms: number) {
    this.ms = ms;
  }
  now: Clock = () => this.ms;
  advanceS(seconds: number): void {
    this.ms += seconds * 1000;
  }
}

export const T0_MS = 1791662400_000;
