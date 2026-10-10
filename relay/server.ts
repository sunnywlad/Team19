// Point d'entrée HTTP de la file : l'IA du client y dépose sa demande de
// décision. Écoute en local uniquement.
//   POST /decision-requests   corps JSON -> 202 acceptée, 400 rejetée, 409 rejeu
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { receiveDecisionRequest } from "./intake.ts";
import type { IntakeDeps } from "./intake.ts";

const MAX_BODY_BYTES = 16 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Au-delà de la limite, on cesse de stocker mais on lit jusqu'au bout
      // pour pouvoir répondre 413 proprement.
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(tooLarge ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createIntakeServer(deps: IntakeDeps): Server {
  return createServer((req, res) => {
    void (async () => {
      if (req.url !== "/decision-requests") return send(res, 404, { error: "introuvable" });
      if (req.method !== "POST") return send(res, 405, { error: "méthode non autorisée" });

      const body = await readBody(req);
      if (body === null) return send(res, 413, { error: "corps trop volumineux" });

      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        raw = undefined; // rejeté et journalisé par la validation
      }
      const result = receiveDecisionRequest(raw, deps);
      if (result.status === "accepted") return send(res, 202, result);
      if (result.status === "duplicate") return send(res, 409, result);
      return send(res, 400, result);
    })().catch(() => {
      // Aucune information interne dans la réponse.
      if (!res.headersSent) send(res, 500, { error: "erreur interne" });
      else res.end();
    });
  });
}
