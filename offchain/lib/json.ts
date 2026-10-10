// lib/json.ts — JSON.stringify avec bigint sérialisés en chaînes décimales

/**
 * stringify : sérialise une valeur en JSON, en convertissant les bigint en chaînes décimales.
 * Conforme au schéma attendu par la passerelle et les vérificateurs (§ 1).
 */
export function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
}
