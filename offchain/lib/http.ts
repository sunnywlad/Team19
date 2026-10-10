// lib/http.ts — utilitaires HTTP : lire le corps, répondre JSON, erreurs

import type { IncomingMessage, ServerResponse } from 'node:http';

// Lit tout le corps de la requête en Buffer (limite à 10 MB)
export function readBody(req: IncomingMessage, limitBytes = 10 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > limitBytes) {
        req.destroy();
        reject(new Error(`Corps trop grand (> ${limitBytes} octets)`));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Lit le corps et le parse en JSON ; lance une erreur HTTP 400 si invalide
export async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  const buf = await readBody(req);
  try {
    return JSON.parse(buf.toString('utf8')) as T;
  } catch {
    const err = new HttpError(400, 'Corps JSON invalide');
    throw err;
  }
}

// Répond avec un objet JSON
export function replyJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

// Répond avec des octets bruts
export function replyBuffer(
  res: ServerResponse,
  status: number,
  body: Buffer,
  contentType = 'application/octet-stream',
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.byteLength,
  });
  res.end(body);
}

// Classe d'erreur HTTP structurée
export class HttpError extends Error {
  readonly status: number;
  constructor(
    status: number,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

// Gestionnaire d'erreurs uniforme pour un handler de route
export function handleError(res: ServerResponse, err: unknown): void {
  if (err instanceof HttpError) {
    replyJson(res, err.status, { error: err.message });
  } else {
    console.error('Erreur interne:', err);
    replyJson(res, 500, { error: 'Erreur interne du serveur' });
  }
}

// Vérifie le Bearer token (comparaison à temps constant via timingSafeEqual)
import { timingSafeEqual } from 'node:crypto';

export function checkBearer(req: IncomingMessage, validTokens: string[]): boolean {
  if (validTokens.length === 0) return false;
  const auth = (req.headers['authorization'] ?? '') as string;
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return false;
  const token = match[1];
  return validTokens.some(valid => {
    try {
      const a = Buffer.from(token);
      const b = Buffer.from(valid);
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}
