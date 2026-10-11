// Jetons d'agent : courts, révocables, jamais stockés en clair (specs/03 § 1).
// Le mandat de l'agent vient de ce registre, indexé par le jeton, jamais du
// corps de la demande.
import { createHash, randomBytes } from "node:crypto";
import type { Action, Clock, Hex } from "./config.ts";

export type AgentIdentity = { agent_id: Hex; client_id: Hex; mandate: Action[] };

export type TokenCause = "TOKEN_MISSING" | "TOKEN_EXPIRED" | "TOKEN_REVOKED" | "TOKEN_UNKNOWN";

export type TokenCheck = { ok: true; agent: AgentIdentity } | { ok: false; cause: TokenCause };

type TokenRecord = AgentIdentity & { expires_at_ms: number; revoked: boolean };

function digest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Extrait le jeton d'un en-tête « Authorization: Bearer … ». */
export function bearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
  return match?.[1] ?? null;
}

export class TokenRegistry {
  readonly #clock: Clock;
  // Seule l'empreinte du jeton est gardée : une fuite du registre ne donne aucun jeton.
  readonly #byDigest = new Map<string, TokenRecord>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** Émet un jeton. Sa valeur n'est rendue qu'ici, une seule fois. */
  issue(agent: AgentIdentity, ttlS: number): string {
    const token = randomBytes(32).toString("base64url");
    this.#byDigest.set(digest(token), {
      agent_id: agent.agent_id,
      client_id: agent.client_id,
      mandate: [...agent.mandate],
      expires_at_ms: this.#clock() + ttlS * 1000,
      revoked: false,
    });
    return token;
  }

  check(token: string | null): TokenCheck {
    if (token === null) return { ok: false, cause: "TOKEN_MISSING" };
    const record = this.#byDigest.get(digest(token));
    if (record === undefined) return { ok: false, cause: "TOKEN_UNKNOWN" };
    if (record.revoked) return { ok: false, cause: "TOKEN_REVOKED" };
    if (this.#clock() >= record.expires_at_ms) return { ok: false, cause: "TOKEN_EXPIRED" };
    return { ok: true, agent: { agent_id: record.agent_id, client_id: record.client_id, mandate: [...record.mandate] } };
  }

  /** Révoque tous les jetons en circulation, avant une nouvelle émission. */
  revokeAll(): void {
    for (const record of this.#byDigest.values()) record.revoked = true;
  }

  /** Révoque définitivement tous les jetons d'un agent. Renvoie leur nombre. */
  revokeAgent(agentId: Hex): number {
    let count = 0;
    for (const record of this.#byDigest.values()) {
      if (record.agent_id === agentId && !record.revoked) {
        record.revoked = true;
        count += 1;
      }
    }
    return count;
  }
}
