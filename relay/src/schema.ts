// Validation stricte de la demande signée contre le schéma gelé de specs/, et
// règles de fenêtre de validité que JSON Schema n'exprime pas (specs/01 § 4).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import { SPECS_DIR, type Policy } from "./config.ts";
import type { SignedRequest } from "./types.ts";

export function loadSchema(name: string): ValidateFunction {
  const schema = JSON.parse(readFileSync(join(SPECS_DIR, "schemas", name), "utf8")) as object;
  return new Ajv2020({ strict: true, allErrors: true }).compile(schema);
}

let requestValidator: ValidateFunction | undefined;

export type ShapeResult = { ok: true; request: SignedRequest } | { ok: false; errorCount: number };

/** Champ inconnu, manquant ou mal typé : rejet. */
export function validateRequestShape(candidate: unknown): ShapeResult {
  requestValidator ??= loadSchema("request.schema.json");
  if (requestValidator(candidate)) return { ok: true, request: candidate as SignedRequest };
  return { ok: false, errorCount: requestValidator.errors?.length ?? 1 };
}

export type WindowDefect = "VALIDITY_WINDOW_INVALID" | "REQUEST_EXPIRED";

/** La fenêtre est contrôlée avant l'expiration, comme dans le contrat. */
export function checkValidityWindow(
  request: Pick<SignedRequest, "issued_at" | "expires_at">,
  nowS: number,
  policy: Policy,
): WindowDefect | null {
  const ttl = request.expires_at - request.issued_at;
  if (ttl <= 0 || ttl > policy.maxTtlS) return "VALIDITY_WINDOW_INVALID";
  if (request.issued_at > nowS + policy.maxClockSkewS) return "VALIDITY_WINDOW_INVALID";
  if (nowS > request.expires_at) return "REQUEST_EXPIRED";
  return null;
}
