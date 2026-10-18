// Mise en forme seulement. Aucune valeur métier n'est calculée ici : un montant
// reste celui que l'API a renvoyé, exprimé dans une autre unité.

const OPAQUE_ID = /^(0x)?[0-9a-f]{16,}$/;
const WEI = /^(0|[1-9][0-9]{0,77})$/;

/** Unité d'affichage : celle du monde de test (specs/examples/fixtures.json, unit_wei). */
export const UNIT_WEI = 10n ** 15n;
export const UNIT_LABEL = "u";
export const UNIT_LEGEND = "1 u = 10¹⁵ wei";

/** 0x1234…abcd. null si la valeur n'a pas la forme d'un identifiant opaque. */
export function abbreviateId(value: string): string | null {
  if (!OPAQUE_ID.test(value)) return null;
  const head = value.startsWith("0x") ? 6 : 4;
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Montant en wei (chaîne décimale) vers l'unité d'affichage. null si absent ou mal formé : jamais 0 par défaut. */
export function formatWei(wei: string | null | undefined): string | null {
  if (typeof wei !== "string" || !WEI.test(wei)) return null;
  const value = BigInt(wei);
  const whole = value / UNIT_WEI;
  const rest = (value % UNIT_WEI).toString().padStart(15, "0").replace(/0+$/, "");
  return rest === "" ? group(whole.toString()) : `${group(whole.toString())},${rest}`;
}

const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const DATE_TIME = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const LONG_DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Date du jour en toutes lettres, sur l'horloge de ce navigateur. */
export function formatLongDate(ms: number): string {
  return LONG_DATE.format(new Date(ms));
}

export function formatTime(ms: number): string {
  return TIME.format(new Date(ms));
}

const DAY_TIME = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const WEEKDAY_TIME = new Intl.DateTimeFormat("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const WEEKDAY_TIME_SECONDS = new Intl.DateTimeFormat("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Date d'une échéance, en heure locale : « mer. 14 oct., 10:24 ». */
export function formatDayTime(ms: number): string {
  return DAY_TIME.format(new Date(ms));
}

/** Borne d'une jauge : « mar. 10:24 », avec les secondes quand la jauge dure moins d'une heure. */
export function formatWeekdayTime(ms: number, withSeconds = false): string {
  return (withSeconds ? WEEKDAY_TIME_SECONDS : WEEKDAY_TIME).format(new Date(ms));
}

export function formatDateTime(ms: number): string {
  return DATE_TIME.format(new Date(ms));
}

/** Durée mesurée sur une horloge en millisecondes. */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = (ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return `${seconds} s`;
}

/** Durée mesurée sur l'horloge des blocs : précision d'une seconde, pas mieux. */
export function formatDurationS(seconds: number): string {
  return `${seconds} s`;
}

/** Temps restant, en minutes et secondes. */
export function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`;
}
