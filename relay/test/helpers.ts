import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPECS_DIR } from "../src/config.ts";
import type { Clock } from "../src/types.ts";
import { loadFixtures } from "../src/world.ts";

export function readSpecJson<T>(relative: string): T {
  return JSON.parse(readFileSync(join(SPECS_DIR, relative), "utf8")) as T;
}

export type { Fixtures } from "../src/world.ts";
export const fixtures = loadFixtures;

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
