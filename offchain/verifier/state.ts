// verifier/state.ts — état persistant par demande du vérificateur
// Écrit sur disque avant l'envoi du commit (sel préservé entre redémarrages).

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Hex } from 'viem';

// ─── Types ───────────────────────────────────────────────────────────────────

// Étapes de traitement d'une demande
// 'pending'  : demande vue, évaluation en cours
// 'commited' : commit envoyé avec succès
// 'revealed' : reveal envoyé avec succès
// 'detailed' : POST /detail envoyé
// 'finalized': finalize envoyé
// 'closed'   : close envoyé (terminal)
export type RequestStep =
  | 'pending'
  | 'committed'
  | 'revealed'
  | 'detailed'
  | 'finalized'
  | 'closed';

export type RequestState = {
  requestId: string;          // bigint en chaîne
  h: Hex;
  commitDeadline: string;     // bigint en chaîne (timestamp unix)
  revealDeadline: string;     // bigint en chaîne
  contestDeadline: string;    // bigint en chaîne (0 avant finalize)
  vote: number;               // 0/1/2
  reasons: number;            // masque uint16
  detailHash: Hex;            // keccak256(detail bytes)
  salt: Hex;                  // 32 octets hex (généré avant commit)
  detail: string;             // detail texte brut (ligne renvoyée par l'évaluateur)
  step: RequestStep;
};

// ─── Helpers disque ───────────────────────────────────────────────────────────

function atomicWrite(path: string, data: string): void {
  const tmp = path + '.' + randomBytes(4).toString('hex') + '.tmp';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, path);
}

// ─── StateStore ───────────────────────────────────────────────────────────────

export class StateStore {
  private readonly path: string;
  private data: Map<string, RequestState>;

  constructor(dataDir: string) {
    this.path = join(dataDir, 'state.json');
    this.data = new Map();
    this._load();
  }

  private _load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, 'utf8');
      const arr = JSON.parse(raw) as RequestState[];
      for (const s of arr) {
        this.data.set(s.requestId, s);
      }
    } catch {
      // état corrompu : on repart de zéro
    }
  }

  private _flush(): void {
    const arr = Array.from(this.data.values());
    atomicWrite(this.path, JSON.stringify(arr, null, 2));
  }

  get(requestId: bigint): RequestState | undefined {
    return this.data.get(String(requestId));
  }

  set(state: RequestState): void {
    this.data.set(state.requestId, state);
    this._flush();
  }

  all(): RequestState[] {
    return Array.from(this.data.values());
  }
}
