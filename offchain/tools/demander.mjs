#!/usr/bin/env node
// demander.mjs — envoie un prompt à la passerelle et affiche le verdict du comité.
// Autonome : Node 22 seulement, aucune dépendance du dépôt.
// Utilisation : GATEWAY_URL=http://127.0.0.1:8700 GATEWAY_TOKEN=... node demander.mjs "<prompt>"
// Variables optionnelles :
//   DEMANDER_AMOUNT     montant en unités mineures de la décision prévue (défaut 400)
//   DEMANDER_TIMEOUT    attente maximale du statut Contest, en secondes (défaut 240)
//   GATEWAY_REQUESTER   adresse du demandeur de la passerelle (défaut : celle de la pile de démo)
import { randomBytes } from 'node:crypto';

const REASONS = ['amount_above_cap', 'beneficiary_not_allowed', 'reference_unknown',
  'decision_inconsistent_with_prompt', 'insufficient_context', 'suspected_injection',
  'duplicate_payment', 'content_mismatch', 'evaluator_error', 'evaluator_timeout'];
const reasonNames = (mask) => {
  const out = REASONS.filter((_, bit) => mask & (1 << bit));
  if (mask & (1 << 15)) out.push('other');
  return out.length ? out.join(', ') : '-';
};

const fail = (msg) => { console.error(`[demander] ERREUR : ${msg}`); process.exit(1); };

const prompt = process.argv[2];
const url = (process.env.GATEWAY_URL ?? '').replace(/\/+$/, '');
const token = process.env.GATEWAY_TOKEN ?? '';
if (!prompt) fail('usage : node demander.mjs "<prompt>"');
if (!url) fail('GATEWAY_URL manquant');
if (!token) fail('GATEWAY_TOKEN manquant');

const amount = process.env.DEMANDER_AMOUNT ?? '400';
const timeoutS = Number(process.env.DEMANDER_TIMEOUT ?? 240);
const requester = process.env.GATEWAY_REQUESTER ?? '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(url + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    fail(`passerelle injoignable (${e.cause?.code ?? e.name}) : tunnel SSH ouvert ? GATEWAY_URL correct ?`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corps non JSON */ }
  if (!res.ok) {
    const why = res.status === 401 ? 'jeton refusé' : res.status === 503 ? 'disjoncteur ouvert (incident), passerelle en refus' : (json?.error ?? text.slice(0, 200));
    fail(`HTTP ${res.status} sur ${method} ${path} : ${why}`);
  }
  return json;
}

const created = await call('POST', '/requests', {
  schemaVersion: 1,
  requester,
  agentId: 'demander',
  prompt,
  context: {},
  plannedDecision: {
    action: 'pay',
    amountMinor: String(amount),
    currency: 'EUR',
    beneficiaryId: 'FR7612345987650123456789014',
    reference: 'INV-E2E-001',
  },
  createdAt: Math.floor(Date.now() / 1000),
  salt: '0x' + randomBytes(32).toString('hex'),
});
const id = created.requestId;
console.log(`demande ${id} créée, attente du comité (max ${timeoutS} s)...`);

const t0 = Date.now();
let state;
for (;;) {
  state = await call('GET', `/requests/${id}`);
  if (state.status === 'Contest' || state.status === 'Closed') break;
  if ((Date.now() - t0) / 1000 > timeoutS) {
    fail(`statut ${state.status} après ${timeoutS} s, pas de verdict (comité lent ou pile arrêtée)`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}

const v = await call('GET', `/requests/${id}/verdicts`);
console.log('');
console.log(`identifiant : ${id}`);
v.verdicts.forEach((x, i) => {
  console.log(`vote ${i + 1}      : ${x.vote} (${reasonNames(x.reasons)}) par ${x.verifier.slice(0, 8)}…`);
});
if (v.verdicts.length < 3) console.log(`attention   : seulement ${v.verdicts.length} vote(s) révélé(s)`);
console.log(`code final  : ${state.code} (statut ${state.status})`);
console.log(`saisie      : non observée (vérificateurs manqués : ${v.missed.length})`);
