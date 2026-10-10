// BOUCHON de la porte d'entrée. La vraie porte (gateway/, Loris) teste chaque
// demande ; celle-ci rend le verdict écrit dans la fixture de la scène, sans
// rien analyser. Elle sert à faire tourner les agents scriptés et à produire
// des sorties conformes à specs/03. À remplacer, pas à enrichir.
import { createHash, randomBytes } from "node:crypto";
import type { ActionName } from "./config.ts";
import type { JournalClient, ReasonCode } from "./journal.ts";
import type { Clock, Hex } from "./types.ts";

/** specs/03 § 2 : ce que l'agent envoie. Proposition non gelée (point i). */
export type Inbound = { agent_id: Hex; client_id: Hex; action: ActionName; ref_id: Hex; document: string };

/** Verdict imposé par la fixture d'une scène. */
export type ScriptedVerdict = { verdict: "PASS" | "BLOCK"; score: number; reason_codes: ReasonCode[] };

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

export interface Gateway {
  /** tokenValid : résultat du contrôle du jeton, que le bouchon ne fait pas lui-même. */
  receive(inbound: Inbound, tokenValid: boolean, scripted: ScriptedVerdict): Promise<DetectorOutput>;
}

// Point p : seuil initial du détecteur (specs/03 § 4).
export const DETECTOR_THRESHOLD = 70;
const VERSION = "bouchon-0";

export type GatewayStubDeps = { journal: JournalClient; clock: Clock; newRequestId?: () => Hex };

export class GatewayStub implements Gateway {
  readonly #deps: GatewayStubDeps;
  constructor(deps: GatewayStubDeps) {
    this.#deps = deps;
  }

  async receive(inbound: Inbound, tokenValid: boolean, scripted: ScriptedVerdict): Promise<DetectorOutput> {
    const { journal, clock } = this.#deps;
    // Point i : request_id est attribué à l'arrivée, y compris pour un rejet.
    const requestId = this.#deps.newRequestId?.() ?? (`0x${randomBytes(32).toString("hex")}` as Hex);
    const receivedAt = clock();
    const base = { request_id: requestId, threshold: DETECTOR_THRESHOLD, received_at_ms: receivedAt, detected_at_ms: receivedAt, detector_version: VERSION };

    if (!tokenValid) {
      // L'agent n'est pas authentifié : son identifiant reste une déclaration.
      await journal.append({
        type: "AUTH_REJECTED",
        component: "GATEWAY",
        request_id: requestId,
        agent_id: null,
        client_id: null,
        data: { received_at_ms: receivedAt, cause: "TOKEN_UNKNOWN", claimed_agent_id: inbound.agent_id },
      });
      return { ...base, agent_id: null, score: null, verdict: "BLOCK", reason_codes: ["TOKEN_INVALID"] };
    }

    const ids = { request_id: requestId, agent_id: inbound.agent_id, client_id: inbound.client_id };
    const documentSha = createHash("sha256").update(inbound.document, "utf8").digest("hex");
    await journal.append({ type: "REQUEST_RECEIVED", component: "GATEWAY", ...ids, data: { received_at_ms: receivedAt, document_sha256: documentSha } });

    const blocked = scripted.verdict === "BLOCK" || scripted.score >= DETECTOR_THRESHOLD;
    const output: DetectorOutput = {
      ...base,
      agent_id: inbound.agent_id,
      score: scripted.score,
      verdict: blocked ? "BLOCK" : "PASS",
      reason_codes: scripted.reason_codes,
    };
    await journal.append({
      type: "DETECTION",
      component: "GATEWAY",
      ...ids,
      data: {
        score: scripted.score,
        threshold: output.threshold,
        verdict: output.verdict,
        reason_codes: output.reason_codes,
        received_at_ms: receivedAt,
        detected_at_ms: output.detected_at_ms,
        detector_version: VERSION,
      },
    });
    if (blocked) return output;

    await journal.append({ type: "REQUEST_PARSED", component: "GATEWAY", ...ids, data: { action: inbound.action, ref_id: inbound.ref_id } });
    await journal.append({ type: "FORWARDED_TO_CLIENT_AI", component: "GATEWAY", ...ids, data: {} });
    return output;
  }
}
