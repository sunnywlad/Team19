// Agents en pause. La porte ne décide pas d'une pause : elle l'applique.
// La source est le journal, qu'elle relit en continu :
//   AGENT_PAUSED                      le service de réponse a mis l'agent en pause
//   HUMAN_DECISION / AGENT_RESUMED    un humain a levé la pause
//   HUMAN_DECISION / TOKEN_REVOKED    un humain a révoqué les jetons de l'agent
// Aucune route de la porte ne permet de lever une pause.
import type { Hex } from "./config.ts";
import { isBytes32 } from "./config.ts";
import type { JournalPort, JournalRecord } from "./journal.ts";
import type { TokenRegistry } from "./tokens.ts";

export class PauseTracker {
  readonly #paused = new Set<string>();
  readonly #tokens: TokenRegistry | undefined;
  #cursor = 0;

  constructor(tokens?: TokenRegistry) {
    this.#tokens = tokens;
  }

  isPaused(agentId: Hex): boolean {
    return this.#paused.has(agentId);
  }

  get cursor(): number {
    return this.#cursor;
  }

  apply(entry: JournalRecord): void {
    this.#cursor = Math.max(this.#cursor, entry.seq + 1);
    if (!isBytes32(entry.agent_id)) return;
    if (entry.type === "AGENT_PAUSED") {
      this.#paused.add(entry.agent_id);
    } else if (entry.type === "HUMAN_DECISION" && entry.data["decision"] === "AGENT_RESUMED") {
      this.#paused.delete(entry.agent_id);
    } else if (entry.type === "HUMAN_DECISION" && entry.data["decision"] === "TOKEN_REVOKED") {
      this.#tokens?.revokeAgent(entry.agent_id);
    }
  }

  /** Relit le journal depuis la dernière entrée vue. Lève si le journal ne répond pas. */
  async sync(journal: JournalPort): Promise<void> {
    let page = await journal.read(this.#cursor);
    if (page.count < this.#cursor) {
      // Le journal est plus court que ce qu'on en a lu : il a été remplacé par
      // une chaîne neuve (remise à zéro de démo). L'état se relit depuis le début.
      this.#paused.clear();
      this.#cursor = 0;
      page = await journal.read(0);
    }
    for (const entry of page.entries) this.apply(entry);
  }
}
