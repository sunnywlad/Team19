// Limite de débit par agent, fenêtre glissante (specs/03 § 5).
import type { Clock } from "./config.ts";

export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #clock: Clock;
  readonly #hits = new Map<string, number[]>();

  constructor(limit: number, windowS: number, clock: Clock) {
    this.#limit = limit;
    this.#windowMs = windowS * 1000;
    this.#clock = clock;
  }

  // Compte la demande et dit si elle passe. Une demande refusée n'est pas
  // comptée : un agent bloqué ne repousse pas indéfiniment sa propre fenêtre.
  allow(key: string): boolean {
    const now = this.#clock();
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.#windowMs);
    const allowed = recent.length < this.#limit;
    if (allowed) recent.push(now);
    this.#hits.set(key, recent);
    return allowed;
  }
}
