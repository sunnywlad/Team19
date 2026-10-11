// Porte d'entrée, étapes 1 à 4 (specs/03).
//
//   1. jeton de l'agent, puis limite de débit
//   2. détecteur : trois signaux, un score
//   3. schéma strict du corps
//   4. transmission à l'IA du client : des identifiants seulement
//
// Un enregistrement de sortie par demande reçue, conforme à
// specs/schemas/detector-output.schema.json. Chaque étape écrit dans le journal
// avant de passer à la suivante : journal indisponible, demande refusée.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import { ACTIONS, SCHEMAS_DIR, isBytes32 } from "./config.ts";
import type { Action, Clock, DetectorOutput, Hex, Policy, ReasonCode } from "./config.ts";
import { detect } from "./detector.ts";
import type { JournalPort, NewJournalEntry } from "./journal.ts";
import { JournalUnavailableError } from "./journal.ts";
import type { PauseTracker } from "./pauses.ts";
import { RateLimiter } from "./ratelimit.ts";
import { bearer } from "./tokens.ts";
import type { AgentIdentity, TokenRegistry } from "./tokens.ts";

/** Ce que la porte transmet à l'IA du client : jamais le document. */
export type Forwarded = { request_id: Hex; agent_id: Hex; client_id: Hex; action: Action; ref_id: Hex };

export type QuarantineStore = { put(requestId: Hex, documentSha256: string, document: string): void };

export type GatewayDeps = {
  policy: Policy;
  clock: Clock;
  tokens: TokenRegistry;
  pauses: PauseTracker;
  journal: JournalPort;
  quarantine: QuarantineStore;
  /** Étape 4. Absent : la porte s'arrête après l'étape 3. */
  forward?: (request: Forwarded) => Promise<void>;
  /** Appelé pour chaque enregistrement de sortie (banc de mesure, dashboard). */
  onOutput?: (output: DetectorOutput) => void;
  newRequestId?: () => Hex;
};

export type Inbound = {
  authorization: string | undefined;
  body: string;
  /** Le corps dépassait la taille admise et a été tronqué. */
  oversize?: boolean;
};

// L'agent ne reçoit que cela : ni score, ni codes, ni seuil (specs/03 § 6).
export type AgentResponse = { request_id: Hex; status: "accepted" | "rejected" };

export type GatewayResult = { httpStatus: number; response: AgentResponse; output: DetectorOutput | null };

type AuthCause = "TOKEN_MISSING" | "TOKEN_EXPIRED" | "TOKEN_REVOKED" | "TOKEN_UNKNOWN" | "AGENT_MISMATCH";

// Fenêtres des signaux d'historique du détecteur.
const DUPLICATE_WINDOW_MS = 60_000;
const BURST_WINDOW_MS = 10_000;
const BURST_COUNT = 3;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class Gateway {
  readonly #deps: GatewayDeps;
  readonly #limiter: RateLimiter;
  readonly #validate: ValidateFunction;
  // Par agent : demandes récentes, pour repérer doublons et rafales.
  readonly #recent = new Map<string, { at: number; ref: string | null; doc: string }[]>();

  constructor(deps: GatewayDeps) {
    this.#deps = deps;
    this.#limiter = new RateLimiter(deps.policy.rateLimit, deps.policy.rateWindowS, deps.clock);
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, "inbound.schema.json"), "utf8")) as object;
    this.#validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  }

  #history(agentId: Hex, now: number, ref: string | null, doc: string): { duplicate: boolean; burst: boolean } {
    const recent = (this.#recent.get(agentId) ?? []).filter((r) => now - r.at < DUPLICATE_WINDOW_MS);
    const duplicate = recent.some((r) => r.doc === doc || (ref !== null && r.ref === ref));
    const burst = recent.filter((r) => now - r.at < BURST_WINDOW_MS).length + 1 >= BURST_COUNT;
    recent.push({ at: now, ref, doc });
    this.#recent.set(agentId, recent);
    return { duplicate, burst };
  }

  async receive(inbound: Inbound): Promise<GatewayResult> {
    const { policy, clock, journal } = this.#deps;
    // Identifiant attribué à l'arrivée, y compris aux demandes rejetées.
    const requestId = this.#deps.newRequestId?.() ?? (`0x${randomBytes(32).toString("hex")}` as Hex);
    const receivedAt = clock();
    const base = { request_id: requestId, threshold: policy.threshold, received_at_ms: receivedAt, detector_version: policy.detectorVersion };

    const finish = (httpStatus: number, output: DetectorOutput): GatewayResult => {
      this.#deps.onOutput?.(output);
      return { httpStatus, response: { request_id: requestId, status: output.verdict === "PASS" ? "accepted" : "rejected" }, output };
    };

    try {
      // Lecture indulgente du corps : il faut pouvoir analyser ce qui est arrivé,
      // même mal formé. La validation stricte vient à l'étape 3.
      let body: Record<string, unknown> | null = null;
      if (inbound.oversize !== true) {
        try {
          const parsed: unknown = JSON.parse(inbound.body);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
        } catch {
          body = null;
        }
      }
      const claimedAgent = isBytes32(body?.["agent_id"]) ? (body["agent_id"] as Hex) : null;

      // --- Étape 1 : jeton. Avant toute lecture du contenu. ---
      await this.#deps.pauses.sync(journal);
      const check = this.#deps.tokens.check(bearer(inbound.authorization));
      let cause: AuthCause | null = check.ok ? null : check.cause;
      if (check.ok) {
        // Un agent en pause est traité comme un jeton révoqué.
        if (this.#deps.pauses.isPaused(check.agent.agent_id)) cause = "TOKEN_REVOKED";
        else if (typeof body?.["agent_id"] === "string" && body["agent_id"] !== check.agent.agent_id) cause = "AGENT_MISMATCH";
        else if (typeof body?.["client_id"] === "string" && body["client_id"] !== check.agent.client_id) cause = "AGENT_MISMATCH";
      }
      if (cause !== null || !check.ok) {
        // Personne n'est authentifié : l'identifiant reste une déclaration.
        await journal.append({
          type: "AUTH_REJECTED",
          component: "GATEWAY",
          request_id: requestId,
          agent_id: null,
          client_id: null,
          data: { received_at_ms: receivedAt, cause: cause ?? "TOKEN_UNKNOWN", claimed_agent_id: claimedAgent },
        });
        return finish(401, { ...base, agent_id: null, score: null, verdict: "BLOCK", reason_codes: ["TOKEN_INVALID"], detected_at_ms: clock() });
      }
      const agent: AgentIdentity = check.agent;
      const ids = { request_id: requestId, agent_id: agent.agent_id, client_id: agent.client_id };
      const entry = (type: string, data: Record<string, unknown>): NewJournalEntry => ({ type, component: "GATEWAY", ...ids, data });

      // --- Étape 1 : limite de débit. Le contenu n'est ni analysé ni transmis. ---
      if (!this.#limiter.allow(agent.agent_id)) {
        await journal.append(entry("RATE_LIMITED", { received_at_ms: receivedAt, limit: policy.rateLimit, window_s: policy.rateWindowS }));
        return finish(429, { ...base, agent_id: agent.agent_id, score: null, verdict: "BLOCK", reason_codes: ["RATE_LIMITED"], detected_at_ms: clock() });
      }

      // Le document, ou à défaut tout ce qui est arrivé.
      const document = typeof body?.["document"] === "string" ? (body["document"] as string) : inbound.body;
      const documentSha = sha256(document);
      await journal.append(entry("REQUEST_RECEIVED", { received_at_ms: receivedAt, document_sha256: documentSha }));

      // --- Étape 2 : détecteur. ---
      const action = ACTIONS.includes(body?.["action"] as Action) ? (body?.["action"] as Action) : null;
      const ref = typeof body?.["ref_id"] === "string" ? (body["ref_id"] as string) : null;
      const detection = detect({ document, action, mandate: agent.mandate, history: this.#history(agent.agent_id, receivedAt, ref, documentSha) });
      const blockedByDetector = detection.score >= policy.threshold;
      const detectedAt = clock();
      await journal.append(
        entry("DETECTION", {
          score: detection.score,
          threshold: policy.threshold,
          verdict: blockedByDetector ? "BLOCK" : "PASS",
          reason_codes: detection.reason_codes,
          received_at_ms: receivedAt,
          detected_at_ms: detectedAt,
          detector_version: policy.detectorVersion,
        }),
      );
      const scored = { ...base, agent_id: agent.agent_id, score: detection.score, detected_at_ms: detectedAt };
      if (blockedByDetector) {
        // Le document est gelé hors de tout contexte de modèle, pour analyse humaine.
        this.#deps.quarantine.put(requestId, documentSha, document);
        // Un score au-dessus du seuil porte toujours au moins un code.
        const codes: ReasonCode[] = detection.reason_codes.length > 0 ? detection.reason_codes : ["INSTRUCTION_IN_DATA"];
        return finish(403, { ...scored, verdict: "BLOCK", reason_codes: codes });
      }

      // --- Étape 3 : schéma strict. ---
      const valid = inbound.oversize !== true && body !== null && this.#validate(body);
      if (!valid) {
        const errorCount = Math.max(1, this.#validate.errors?.length ?? 1);
        await journal.append(entry("SCHEMA_REJECTED", { error_count: body === null ? 1 : errorCount }));
        this.#deps.quarantine.put(requestId, documentSha, document);
        return finish(inbound.oversize === true ? 413 : 400, {
          ...scored,
          verdict: "BLOCK",
          reason_codes: [...detection.reason_codes, "SCHEMA_INVALID"],
        });
      }
      const parsed = body as { action: Action; ref_id: Hex };
      await journal.append(entry("REQUEST_PARSED", { action: parsed.action, ref_id: parsed.ref_id }));

      // --- Étape 4 : l'IA du client reçoit des identifiants, jamais le document. ---
      if (this.#deps.forward !== undefined) {
        // Journal avant action : l'entrée précède l'appel. Journal indisponible, rien n'est transmis.
        await journal.append(entry("FORWARDED_TO_CLIENT_AI", {}));
        try {
          await this.#deps.forward({ ...ids, action: parsed.action, ref_id: parsed.ref_id });
        } catch {
          // La transmission n'a pas abouti : la demande n'ira pas plus loin. Le
          // journal garde l'entrée, sans REQUEST_SIGNED derrière.
          return { httpStatus: 502, response: { request_id: requestId, status: "rejected" }, output: null };
        }
      }
      return finish(202, { ...scored, verdict: "PASS", reason_codes: detection.reason_codes });
    } catch (error) {
      if (error instanceof JournalUnavailableError) {
        // Journal avant action : sans journal, la porte ne laisse rien passer.
        return { httpStatus: 503, response: { request_id: requestId, status: "rejected" }, output: null };
      }
      throw error;
    }
  }
}
