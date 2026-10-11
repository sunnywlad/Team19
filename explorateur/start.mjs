// Démarre l'explorateur VETO : MongoDB, API, indexeur, front. Relançable sans risque. Node 22, Windows/Linux/macOS.
// Le tunnel vers le L1 doit déjà être ouvert. RPC=<url> pour un autre port que 9670.
// --rattrapage : réindexe tous les blocs (dix minutes), à faire si la chaîne a avancé pendant l'arrêt.
import { spawn } from 'node:child_process';
import { openSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const D = path.dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC ?? 'http://127.0.0.1:9670/ext/bc/RkJGt3ZenMaUz64EP1cUZeisftYMb9WaJdvYw54xfvkUccgke/rpc';
const BACK = path.join(D, 'erol-explorer-backend');
const FRONT = path.join(D, 'codenekt-explorer-frontend');
const PIDS = path.join(D, '.pids');
mkdirSync(PIDS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => { console.error('ECHEC : ' + msg); process.exit(1); };

const ecoute = (port) => new Promise((ok) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => { s.destroy(); ok(true); });
  s.on('error', () => ok(false));
});
async function attend(port, nom) {
  for (let i = 0; i < 90; i++) { if (await ecoute(port)) return; await sleep(1000); }
  die(`rien n'écoute sur ${port} (${nom}), voir les journaux dans ${D}`);
}
async function bloc() {
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}', signal: AbortSignal.timeout(5000) });
    return parseInt((await r.json()).result, 16);
  } catch { return null; }
}
function vivant(nom) {
  const f = path.join(PIDS, nom);
  if (!existsSync(f)) return false;
  try { process.kill(Number(readFileSync(f, 'utf8')), 0); return true; } catch { return false; }
}
function lance(nom, cmd, args, cwd, shell) {
  const log = openSync(path.join(D, `${nom}.log`), 'w');
  const p = spawn(cmd, args, { cwd, shell, detached: true, stdio: ['ignore', log, log], windowsHide: true });
  p.unref();
  writeFileSync(path.join(PIDS, nom), String(p.pid));
}
function reecrit(fichier, cle, valeur) {
  const t = readFileSync(fichier, 'utf8').split(/\r?\n/).map((l) => (l.startsWith(cle + '=') ? `${cle}=${valeur}` : l));
  writeFileSync(fichier, t.join('\n'));
}

if ((await bloc()) === null) die(`le RPC ne répond pas (${RPC}). Le tunnel est-il ouvert ?`);

reecrit(path.join(BACK, '.env'), 'RPC_URL', RPC);
reecrit(path.join(FRONT, '.env'), 'PUBLIC_RPC_URL', RPC);

if (!(await ecoute(27018))) { lance('mongo', process.execPath, ['start-mongo.mjs'], path.join(D, 'mongo'), false); await attend(27018, 'MongoDB'); }
if (!(await ecoute(3050))) { lance('api', 'npm', ['run', 'start:api'], BACK, true); await attend(3050, 'API'); }
if (!vivant('indexer')) lance('indexer', 'npm', ['run', 'start:indexer'], BACK, true);
if (!(await ecoute(5180))) { lance('front', 'npm', ['run', 'dev', '--', '--port', '5180', '--host', '0.0.0.0'], FRONT, true); await attend(5180, 'front'); }
if (process.argv.includes('--rattrapage')) lance('backfill', 'npx', ['ts-node', 'backfill.ts'], BACK, true);

let n = null;
try { n = await (await fetch('http://127.0.0.1:5180/api/tx-count', { signal: AbortSignal.timeout(60000) })).text(); } catch {}
console.log(`chaîne : bloc ${await bloc()}  |  transactions indexées : ${n ?? 'inconnu (le front chauffe, recharger)'}`);
console.log('Explorateur : http://127.0.0.1:5180');
