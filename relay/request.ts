// Demande de décision émise par l'IA du client (étape 6). Elle ne contient que
// des identifiants : montant et bénéficiaire sont lus par le contrat dans ses
// registres. Le contrat vérifie la signature sur ces champs exacts, donc aucun
// champ n'est transformé avant la soumission.
//
// Format proposé, à confirmer dans specs/ avec le contrat.

export const ACTIONS = ["PAY_INVOICE", "PLACE"] as const;
export type Action = (typeof ACTIONS)[number];

export type DecisionRequest = {
  request_id: string;
  client_id: string;
  agent_id: string;
  action: Action;
  ref_id: string;
  issued_at: number; // secondes Unix
  expires_at: number; // secondes Unix
  signature: string; // 0x + 65 octets en hexadécimal
};

export type ParseResult = { ok: true; request: DecisionRequest } | { ok: false; errors: string[] };

const FIELDS = ["request_id", "client_id", "agent_id", "action", "ref_id", "issued_at", "expires_at", "signature"];
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

// Une demande vit quelques minutes : au-delà, elle est refusée.
export const MAX_VALIDITY_SECONDS = 15 * 60;
// Tolérance d'horloge entre l'émetteur et nous.
export const CLOCK_SKEW_SECONDS = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Validation stricte : tout champ inconnu, manquant ou mal typé est un rejet.
// Les messages ne reprennent jamais la valeur reçue, qui peut être hostile.
export function parseRequest(raw: unknown, nowSeconds: number): ParseResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ["la demande doit être un objet JSON"] };
  }
  const errors: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!FIELDS.includes(key)) errors.push(`champ inconnu : ${ID_PATTERN.test(key) ? key : "(nom invalide)"}`);
  }
  for (const key of FIELDS) {
    if (!(key in raw)) errors.push(`champ manquant : ${key}`);
  }
  for (const key of ["request_id", "client_id", "agent_id", "ref_id"]) {
    const value = raw[key];
    if (key in raw && (typeof value !== "string" || !ID_PATTERN.test(value))) {
      errors.push(`${key} : identifiant attendu (1 à 64 caractères, lettres, chiffres, _ ou -)`);
    }
  }
  if ("action" in raw && !ACTIONS.includes(raw["action"] as Action)) {
    errors.push(`action : valeur attendue parmi ${ACTIONS.join(", ")}`);
  }
  for (const key of ["issued_at", "expires_at"]) {
    const value = raw[key];
    if (key in raw && (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)) {
      errors.push(`${key} : entier de secondes Unix attendu`);
    }
  }
  if ("signature" in raw && (typeof raw["signature"] !== "string" || !SIGNATURE_PATTERN.test(raw["signature"]))) {
    errors.push("signature : 0x suivi de 130 caractères hexadécimaux attendu");
  }
  if (errors.length > 0) return { ok: false, errors };

  const request = raw as DecisionRequest;
  if (request.expires_at <= request.issued_at) {
    errors.push("expires_at doit être postérieur à issued_at");
  } else if (request.expires_at - request.issued_at > MAX_VALIDITY_SECONDS) {
    errors.push(`durée de validité supérieure à ${MAX_VALIDITY_SECONDS} secondes`);
  }
  if (request.issued_at > nowSeconds + CLOCK_SKEW_SECONDS) {
    errors.push("issued_at est dans le futur");
  }
  if (request.expires_at <= nowSeconds) {
    errors.push("demande expirée");
  }
  if (errors.length > 0) return { ok: false, errors };

  // Copie champ par champ : l'objet rendu ne porte rien d'autre.
  return {
    ok: true,
    request: {
      request_id: request.request_id,
      client_id: request.client_id,
      agent_id: request.agent_id,
      action: request.action,
      ref_id: request.ref_id,
      issued_at: request.issued_at,
      expires_at: request.expires_at,
      signature: request.signature,
    },
  };
}
