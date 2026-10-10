// Pseudonymisation par empreinte à clé (HMAC-SHA256). Sans la clé, on ne peut
// ni retrouver l'identifiant d'origine ni tester des valeurs candidates.
// Ce n'est pas une anonymisation : qui détient la clé peut refaire le lien.
import { createHmac } from "node:crypto";

export function pseudonymize(value: string, key: string): string {
  if (key.length < 16) {
    throw new Error("clé de pseudonymisation absente ou trop courte (16 caractères au moins)");
  }
  return `p_${createHmac("sha256", key).update(value).digest("hex").slice(0, 24)}`;
}

// Lit la clé dans l'environnement. Absente : on échoue, on ne stocke jamais
// un identifiant en clair par défaut.
export function pseudonymKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const key = env["PSEUDONYM_KEY"];
  if (key === undefined || key.length < 16) {
    throw new Error("PSEUDONYM_KEY absente ou trop courte : voir .env.example");
  }
  return key;
}
