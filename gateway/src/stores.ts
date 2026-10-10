// Stockage local de la porte : documents en quarantaine et enregistrements de
// sortie. Tout vit sous var/, jamais versionné.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DetectorOutput, Hex } from "./config.ts";
import type { QuarantineStore } from "./gateway.ts";

// Un document bloqué est gelé ici, hors du journal et hors de tout contexte de
// modèle. Seul un humain le relit. Le journal n'en garde que l'empreinte.
export class FileQuarantine implements QuarantineStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  put(requestId: Hex, documentSha256: string, document: string): void {
    // Le nom du fichier vient de l'identifiant attribué par la porte, jamais du contenu reçu.
    writeFileSync(
      join(this.#dir, `${requestId}.json`),
      JSON.stringify({ request_id: requestId, document_sha256: documentSha256, document }),
      { encoding: "utf8", mode: 0o600 },
    );
  }
}

export class MemoryQuarantine implements QuarantineStore {
  readonly items = new Map<string, { documentSha256: string; document: string }>();

  put(requestId: Hex, documentSha256: string, document: string): void {
    this.items.set(requestId, { documentSha256, document });
  }
}

/** Enregistrements de sortie, lus par le banc de mesure et le dashboard. */
export class OutputLog {
  readonly #outputs: DetectorOutput[] = [];
  readonly #file: string | undefined;

  constructor(file?: string) {
    this.#file = file;
  }

  add(output: DetectorOutput): void {
    this.#outputs.push(output);
    if (this.#file !== undefined) appendFileSync(this.#file, `${JSON.stringify(output)}\n`, "utf8");
  }

  from(index: number, limit: number): DetectorOutput[] {
    return this.#outputs.slice(index, index + limit);
  }

  get count(): number {
    return this.#outputs.length;
  }
}
