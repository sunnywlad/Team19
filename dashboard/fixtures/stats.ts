// GET /stats/daily du serveur de fixtures (API-NEEDS.md § 9) : les agrégats
// que le relais servirait, calculés sur TOUT le monde simulé avec les mêmes
// dérivations que la console (src/domain/apercu.ts). La console n'en lit que
// les 500 derniers événements ; ces totaux, eux, couvrent les 30 jours.
import type { DailyStat, DailyStats } from "../src/api/types.ts";
import { blockedRequests, REASON_APPROVED, REASON_NONE } from "../src/domain/apercu.ts";
import { readDecision } from "../src/domain/reasons.ts";
import { toDecisions, type World } from "./sim.ts";

const DAYS = 30;
const WEI = /^(0|[1-9][0-9]{0,77})$/;

/** Fuseau du processus : celui des jours civils servis. */
export function serverTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Jour civil d'un instant, dans un fuseau : « 2026-10-18 ». */
export function dayKey(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Les 30 jours civils qui finissent aujourd'hui, du plus ancien au plus récent. */
function lastDays(now: number, timeZone: string): string[] {
  const keys: string[] = [];
  // Pas de 24 h : on recule d'heure en heure jusqu'au jour précédent, ce qui tient aux changements d'heure.
  let cursor = now;
  let key = dayKey(cursor, timeZone);
  keys.unshift(key);
  while (keys.length < DAYS) {
    cursor -= 3_600_000;
    const next = dayKey(cursor, timeZone);
    if (next !== key) {
      key = next;
      keys.unshift(key);
    }
  }
  return keys;
}

export function dailyStats(world: World, now: number, timeZone: string = serverTimezone()): DailyStats {
  const keys = lastDays(now, timeZone);
  const days = new Map<string, DailyStat & { paidAuto: bigint; paidApproved: bigint; blockedWei: bigint }>(
    keys.map((date) => [
      date,
      { date, paid_auto: 0, paid_auto_wei: "0", paid_approved: 0, paid_approved_wei: "0", blocked: 0, blocked_gate: 0, blocked_wei: "0", blocked_unknown: 0, paidAuto: 0n, paidApproved: 0n, blockedWei: 0n },
    ]),
  );
  const decisions = toDecisions(world.events);
  const byRequest = new Map(decisions.filter((d) => readDecision(d).kind === "accepte").map((d) => [d.request_id, d]));

  // Payés : chaque événement Paid, au jour de son bloc, selon le motif de la décision qui l'a permis.
  for (const e of world.events) {
    if (e.name !== "Paid") continue;
    const day = days.get(dayKey(e.block_timestamp * 1000, timeZone));
    const decision = byRequest.get(String(e.args.requestId));
    const amount = typeof e.args.amount === "string" && WEI.test(e.args.amount) ? BigInt(e.args.amount) : null;
    if (!day || !decision || amount === null) continue;
    if (decision.reason === REASON_NONE) {
      day.paid_auto += 1;
      day.paidAuto += amount;
    } else if (decision.reason === REASON_APPROVED) {
      day.paid_approved += 1;
      day.paidApproved += amount;
    }
  }

  // Bloqués : exactement ce que la console compte (refus du contrat, blocages à la porte).
  for (const b of blockedRequests(decisions, world.events, world.journal, true)) {
    const day = days.get(dayKey(b.atMs, timeZone));
    if (!day) continue;
    day.blocked += 1;
    if (b.origin === "porte") day.blocked_gate += 1;
    if (b.amountWei === null) day.blocked_unknown += 1;
    else day.blockedWei += BigInt(b.amountWei);
  }

  return {
    version: 1,
    timezone: timeZone,
    generated_at_ms: now,
    days: keys.map((key) => {
      const { paidAuto, paidApproved, blockedWei, ...day } = days.get(key)!;
      return { ...day, paid_auto_wei: paidAuto.toString(), paid_approved_wei: paidApproved.toString(), blocked_wei: blockedWei.toString() };
    }),
  };
}
