// Paramètres de la porte d'entrée. Les valeurs chiffrées viennent de
// specs/00-a-trancher.md, point p.
import { join } from "node:path";

export const SPECS_DIR = join(import.meta.dirname, "..", "..", "specs");
export const SCHEMAS_DIR = join(import.meta.dirname, "..", "schemas");

export const ACTIONS = ["PAY_INVOICE", "PLACE"] as const;
export type Action = (typeof ACTIONS)[number];

export type Hex = `0x${string}`;
export type Clock = () => number; // millisecondes Unix

export const REASON_CODES = [
  "INSTRUCTION_IN_DATA",
  "AUTHORITY_VIOLATION",
  "PAYMENT_ANOMALY",
  "SCHEMA_INVALID",
  "TOKEN_INVALID",
  "RATE_LIMITED",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type Policy = {
  /** Seuil du détecteur, borne incluse : score ≥ seuil donne BLOCK. */
  threshold: number;
  rateLimit: number;
  rateWindowS: number;
  /** Taille maximale du corps, en octets. Au-delà, la demande est rejetée. */
  maxBodyBytes: number;
  tokenTtlS: number;
  detectorVersion: string;
};

export const DEFAULT_POLICY: Policy = {
  threshold: 70,
  rateLimit: 5,
  rateWindowS: 10,
  maxBodyBytes: 16 * 1024,
  tokenTtlS: 900,
  detectorVersion: "regles-0.1",
};

/** specs/schemas/detector-output.schema.json */
export type DetectorOutput = {
  request_id: Hex;
  agent_id: Hex | null;
  score: number | null;
  threshold: number;
  verdict: "PASS" | "BLOCK";
  reason_codes: ReasonCode[];
  received_at_ms: number;
  detected_at_ms: number;
  detector_version: string;
};

const BYTES32 = /^0x[0-9a-f]{64}$/;
const ZERO = `0x${"0".repeat(64)}`;

export function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && BYTES32.test(value) && value !== ZERO;
}
