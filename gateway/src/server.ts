// Interface HTTP de la porte d'entrée. Écoute en local uniquement.
//
//   POST /requests   demande d'un agent. En-tête « Authorization: Bearer <jeton> »,
//                    corps JSON conforme à schemas/inbound.schema.json.
//                    Réponse : { request_id, status } et rien d'autre.
//                    202 acceptée ; 400 schéma ; 401 jeton ; 403 bloquée ;
//                    413 corps trop gros ; 429 débit ; 502 et 503 indisponibilité.
//   GET  /outputs    ?from=n&limit=m : enregistrements de sortie (specs/03 § 3),
//                    pour le banc de mesure et le dashboard.
//   GET  /health     état du service.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Gateway } from "./gateway.ts";
import type { OutputLog } from "./stores.ts";

const UINT = /^(0|[1-9][0-9]{0,9})$/;
const MAX_OUTPUTS = 500;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

// Lit le corps jusqu'à la limite. Au-delà, on garde le début pour l'analyse et
// on signale le dépassement, sans jamais stocker plus que la limite.
function readBody(req: IncomingMessage, maxBytes: number): Promise<{ text: string; oversize: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let kept = 0;
    let oversize = false;
    req.on("data", (chunk: Buffer) => {
      const room = maxBytes - kept;
      if (chunk.length > room) oversize = true;
      if (room > 0) {
        const part = chunk.subarray(0, room);
        chunks.push(part);
        kept += part.length;
      }
    });
    req.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), oversize }));
    req.on("error", reject);
  });
}

export function createGatewayServer(gateway: Gateway, outputs: OutputLog, maxBodyBytes: number): Server {
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname === "/requests") {
        if (req.method !== "POST") return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
        const { text, oversize } = await readBody(req, maxBodyBytes);
        const result = await gateway.receive({ authorization: req.headers.authorization, body: text, oversize });
        return send(res, result.httpStatus, result.response);
      }

      if (url.pathname === "/outputs" && req.method === "GET") {
        const from = url.searchParams.get("from") ?? "0";
        const limit = url.searchParams.get("limit") ?? String(MAX_OUTPUTS);
        if (!UINT.test(from) || !UINT.test(limit)) return send(res, 400, { error: "INVALID_QUERY" });
        return send(res, 200, { outputs: outputs.from(Number(from), Math.min(Number(limit), MAX_OUTPUTS)), count: outputs.count });
      }

      if (url.pathname === "/health" && req.method === "GET") return send(res, 200, { status: "ok", outputs: outputs.count });

      return send(res, 404, { error: "NOT_FOUND" });
    })().catch(() => {
      // Aucune information interne dans la réponse.
      if (!res.headersSent) send(res, 500, { error: "INTERNAL" });
      else res.end();
    });
  });
}
