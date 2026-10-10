// Scénarios de specs/acceptance/scenarios.md, joués par la VRAIE porte d'entrée.
//
//   DEMO_MODE=1 node demo/scenes.mjs            toutes : 1 2 3 4 5 6a 6b 7a 7b 8
//   DEMO_MODE=1 node demo/scenes.mjs 4 6b       celles-là seulement
//   … --json <fichier>                          résultats, sans identifiant ni horodatage
//
// Chaque demande part en HTTP vers POST /requests avec le jeton de l'agent, puis
// le script lit ce que les services ont réellement fait : sortie du détecteur
// (porte, /outputs), journal (response), décisions, événements, état du coffre
// et file (relais). Il compare à ce que la spec attend et n'arrange rien : un
// écart s'affiche et fait sortir en code 1.
//
// « Chaque scénario part d'un état neuf » (spec, « Monde de test ») : chaque
// scène commence par la remise à zéro de la démo (lib.mjs, reset). C'est aussi
// ce qui permet de jouer 6a puis 6b, et la 1 à l'intérieur de la 8.
//
// Document de la scène 4, le cas manqué : échantillon d-105 de
// data/jeu-factures/dev.jsonl, famille « pression-urgence ». Un faux
// fournisseur presse de virer tout de suite et de ne pas faire remonter le
// dossier, sans aucune des tournures d'ordre que les règles décrivent. Avec
// regles-0.3, le détecteur lui donne 45 : sous le seuil de 70, il passe. Repéré
// en faisant tourner le détecteur sur dev.jsonl ; test.jsonl n'a pas été ouvert.
// Le seuil et les règles ne sont pas touchés : si elles changent et que ce
// document est bloqué, la scène 4 le dira (écart sur la porte).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bringUpChain } from "./chain.mjs";
import { DemoError, ROOT, getJson, loadConfig, postJson, queueEnv, reset, run, service, sleep, startService, status, stopService } from "./lib.mjs";

const MISSED_SAMPLE = "d-105";
const INVOICE = "Facture synthétique. Merci de payer sous 30 jours.";
const PLACEMENT = "Ordre de placement synthétique.";
const NOMINAL = ["REQUEST_RECEIVED", "DETECTION", "REQUEST_PARSED", "FORWARDED_TO_CLIENT_AI", "REQUEST_SIGNED", "ENQUEUED", "SUBMITTED"];
const DECISION_WAIT_MS = 20_000;

const config = loadConfig();
const fixtures = JSON.parse(readFileSync(join(ROOT, "specs", "examples", "fixtures.json"), "utf8"));
const ids = fixtures.ids;
const labels = Object.fromEntries(Object.entries(ids).map(([label, id]) => [id, label]));
const UNIT = BigInt(fixtures.unit_wei);
const units = (wei) => (wei === null || wei === undefined ? "?" : String(BigInt(wei) / UNIT));
const REASONS = ["NONE", "INVOICE_UNKNOWN", "INVOICE_ALREADY_PAID", "REQUEST_REPLAYED", "SIGNATURE_INVALID", "REQUEST_EXPIRED", "EXCEEDS_PLACEABLE", "VAULT_PAUSED", "AGENT_PAUSED", "AGENT_NOT_AUTHORIZED", "ABOVE_THRESHOLD", "APPROVAL_TIMEOUT", "APPROVAL_REFUSED", "APPROVED"];

// --- Lecture des services ------------------------------------------------------

const gateway = config.url("gateway");
const journalUrl = config.url("response");
const relayUrl = config.url("relay");

function token(agent) {
  const file = JSON.parse(readFileSync(join(config.gatewayDataDir, "agent-tokens.json"), "utf8"));
  return file.agents[agent].token;
}

/** Envoie une demande à la porte. `bearer` remplace le jeton de l'agent (scène 2). */
async function send(agent, action, ref, document, bearer) {
  const body = { agent_id: ids[agent], client_id: ids["C-DEMO"], action, ref_id: ids[ref], document };
  const reply = await postJson(`${gateway}/requests`, body, { authorization: `Bearer ${bearer ?? token(agent)}` });
  return { http: reply.status, status: reply.body?.status ?? "?", id: reply.body?.request_id };
}

function label(entry) {
  if (entry.type === "DECISION_OBSERVED") return `DECISION_OBSERVED(${entry.data.decision},${entry.data.reason})`;
  if (entry.type === "AGENT_PAUSED") return `AGENT_PAUSED(${entry.data.scope})`;
  if (entry.type === "ALERT_SENT") return `ALERT_SENT(${entry.data.kind})`;
  return entry.type;
}

async function journal(requestId) {
  const all = [];
  for (let from = 0; ; ) {
    const page = await getJson(`${journalUrl}/journal/entries?from_seq=${from}&limit=1000${requestId ? `&request_id=${requestId}` : ""}`);
    all.push(...page.entries);
    if (page.entries.length < 1000) return all;
    from = page.entries.at(-1).seq + 1;
  }
}
const journalLabels = async (requestId) => (await journal(requestId)).map(label);

async function output(requestId) {
  const { count } = await getJson(`${gateway}/outputs?from=0&limit=0`);
  const { outputs } = await getJson(`${gateway}/outputs?from=${Math.max(0, count - 200)}&limit=200`);
  return outputs.find((o) => o.request_id === requestId) ?? null;
}

const decisions = async (requestId) => (await getJson(`${relayUrl}/decisions?request_id=${requestId}`)).map((d) => `${d.decision}/${d.reason_name ?? d.reason}`);
const events = async (name) => getJson(`${relayUrl}/events?name=${name}&limit=500`);
const queueRows = async (requestId) => (await getJson(`${relayUrl}/queue?limit=500`)).filter((row) => row.request_id === requestId);
const paused = async () => (await getJson(`${journalUrl}/agents/paused`)).map((p) => `${labels[p.agent_id] ?? "?"}(${p.scope})`);
const incidents = async () => [...new Set((await getJson(`${journalUrl}/incidents`)).map((i) => i.report.trigger))];

async function paid(requestId) {
  return (await events("Paid")).filter((e) => requestId === undefined || e.request_id === requestId).map((e) => `${units(e.args.amount)}→${labels[e.args.beneficiaryId] ?? "?"}`);
}

async function vault() {
  const v = await getJson(`${relayUrl}/vault`);
  return { cash: units(v.cash_wei), dettes: units(v.admitted_debts_wei), "bloqué": units(v.total_held_wei), "plaçable": units(v.placeable_wei) };
}

/** Attend que `read()` satisfasse `done`, au plus `timeoutMs`. Rend la dernière lecture, satisfaite ou non. */
async function until(read, done, timeoutMs = DECISION_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await read();
      if (done(value)) return value;
    } catch {
      // service en cours de relance : nouvelle lecture
    }
    if (Date.now() >= deadline) return value;
    await sleep(250);
  }
}

/** Journal d'une demande une fois `last` écrit (ou le délai passé), puis un temps de repos pour voir ce qui suit. */
async function settledJournal(requestId, last, timeoutMs = DECISION_WAIT_MS) {
  await until(() => journalLabels(requestId), (seen) => seen.includes(last), timeoutMs);
  await sleep(1500);
  return journalLabels(requestId);
}

// --- Comparaison -------------------------------------------------------------

const show = (value) => (Array.isArray(value) ? (value.length === 0 ? "aucun" : value.join(", ")) : typeof value === "object" && value !== null ? Object.entries(value).map(([k, v]) => `${k} ${v}`).join(" ") : String(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function compact(list) {
  return same(list.slice(0, NOMINAL.length), NOMINAL) ? ["parcours nominal", ...list.slice(NOMINAL.length)] : list;
}

class Scene {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.checks = [];
    this.notes = [];
  }
  /** Compare et retient. `ok` absent : égalité stricte. */
  check(point, expected, observed, ok) {
    this.checks.push({ point, expected: show(expected), observed: show(observed), ok: ok ?? same(expected, observed) });
  }
  journal(point, expected, observed, { tail = false } = {}) {
    const ok = tail ? same(observed.slice(-expected.length), expected) : same(expected, observed);
    this.checks.push({ point, expected: `${tail ? "… " : ""}${show(compact(expected))}`, observed: show(compact(observed)), ok });
  }
  note(text) {
    this.notes.push(text);
  }
  get gaps() {
    return this.checks.filter((c) => !c.ok);
  }
}

/** Porte d'entrée : réponse HTTP faite à l'agent et enregistrement de sortie du détecteur. */
async function checkGateway(scene, sent, expected, point = "porte") {
  const out = await output(sent.id);
  const observed = { http: sent.http, verdict: out?.verdict ?? "?", score: out?.score ?? "null", codes: show(out?.reason_codes ?? []) };
  let ok = sent.http === expected.http && out?.verdict === expected.verdict;
  if (expected.verdict === "PASS") ok &&= typeof out?.score === "number" && out.score < out.threshold;
  if (expected.codes !== undefined) ok &&= same(out?.reason_codes ?? [], expected.codes);
  if (expected.code !== undefined) ok &&= (out?.reason_codes ?? []).includes(expected.code);
  if (expected.blockedByScore) ok &&= typeof out?.score === "number" && out.score >= out.threshold;
  const want = `${expected.http} ${expected.verdict}${expected.verdict === "PASS" ? " score<70" : ""}${expected.blockedByScore ? " score≥70" : ""}${expected.codes ? ` codes ${show(expected.codes)}` : ""}${expected.code ? ` ${expected.code}` : ""}`;
  scene.checks.push({ point, expected: want, observed: show(observed), ok });
}

/** Aucune réaction du service de réponse : ni pause, ni incident, ni alerte. */
async function checkNoResponse(scene, { alerts = [] } = {}) {
  const all = await journal();
  const reactions = all.filter((e) => e.component === "RESPONSE" && e.type !== "DECISION_OBSERVED").map(label);
  scene.check("réponse", { pauses: "aucun", incidents: "aucun", "réactions": show(alerts) }, { pauses: show(await paused()), incidents: show(await incidents()), "réactions": show(reactions) });
}

/** Geste de l'approbateur : port de contrôle du faux coffre, ou clé APPROBATEUR sur la chaîne. */
async function human(action, requestId) {
  if (config.mode === "fake") {
    const reply = await postJson(`${config.url("control")}/demo/${action}`, { request_id: requestId });
    return reply.status === 200 ? "appel accepté" : `appel refusé (${reply.body?.error ?? reply.status})`;
  }
  const called = run(process.execPath, [join(ROOT, "demo", "human.mjs"), action, requestId], { cwd: ROOT });
  return called.status === 0 ? "appel accepté" : `appel refusé (${called.stdout.trim().split("\n").at(-1) || called.status})`;
}

// --- Scènes ------------------------------------------------------------------

async function scene1(scene) {
  const sent = await send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE);
  const seen = await settledJournal(sent.id, "DECISION_OBSERVED(2,0)");
  await checkGateway(scene, sent, { http: 202, verdict: "PASS", codes: [] });
  scene.check("contrat", ["2/NONE"], await decisions(sent.id));
  scene.check("Paid", ["10→B-001"], await paid(sent.id));
  scene.check("état", { cash: "90", dettes: "30", "bloqué": "0", "plaçable": "20" }, await vault());
  await checkNoResponse(scene);
  scene.journal("journal", [...NOMINAL, "DECISION_OBSERVED(2,0)"], seen);
  return sent;
}

async function scene2(scene) {
  const bad = "jeton-absent-du-registre";
  const sent = await send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE, bad);
  await sleep(1000);
  const out = await output(sent.id);
  scene.check("porte", { http: 401, verdict: "BLOCK", score: "null", agent: "null", codes: "TOKEN_INVALID" }, { http: sent.http, verdict: out?.verdict ?? "?", score: String(out?.score), agent: String(out?.agent_id), codes: show(out?.reason_codes ?? []) });
  scene.check("contrat", "non atteint", (await queueRows(sent.id)).length + (await decisions(sent.id)).length === 0 ? "non atteint" : "atteint");
  scene.journal("journal", ["AUTH_REJECTED"], await journalLabels(sent.id));
  await checkNoResponse(scene);

  // « Et quand » : trois demandes de ce type en moins de 60 s.
  await send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE, bad);
  await send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE, bad);
  const all = await until(async () => (await journal()).map(label), (seen) => seen.includes("ALERT_SENT(REPETITION)"), 5000);
  scene.journal("journal, trois en 60 s", ["AUTH_REJECTED", "AUTH_REJECTED", "AUTH_REJECTED", "ALERT_SENT(REPETITION)"], all);
  scene.check("réponse, trois en 60 s", { pauses: "aucun", incidents: "aucun" }, { pauses: show(await paused()), incidents: show(await incidents()) });
}

async function scene3(scene) {
  const trapped = JSON.parse(readFileSync(join(ROOT, "specs", "examples", "inbound", "valid", "03-document-piege.json"), "utf8")).document;
  const sent = await send("A-DEM-2", "PAY_INVOICE", "F-001", trapped);
  const seen = await settledJournal(sent.id, "INCIDENT_REPORT_GENERATED", 8000);
  await checkGateway(scene, sent, { http: 403, verdict: "BLOCK", blockedByScore: true, code: "INSTRUCTION_IN_DATA" });
  scene.check("IA du client", "ne reçoit rien", seen.includes("REQUEST_SIGNED") || (await queueRows(sent.id)).length > 0 ? "a reçu la demande" : "ne reçoit rien");
  scene.check("contrat", "non atteint", (await decisions(sent.id)).length === 0 ? "non atteint" : "atteint");
  scene.check("réponse", { pauses: "A-DEM-2(OFFCHAIN)", incidents: "DETECTOR_SCORE" }, { pauses: show(await paused()), incidents: show(await incidents()) });
  scene.journal("journal", ["REQUEST_RECEIVED", "DETECTION", "QUARANTINED", "AGENT_PAUSED(OFFCHAIN)", "ALERT_SENT(SECURITY)", "INCIDENT_REPORT_GENERATED"], seen.filter((l) => l !== "AGENT_PAUSED(ONCHAIN)"));
  scene.note(`« plus tard AGENT_PAUSED (ONCHAIN) » : ${seen.includes("AGENT_PAUSED(ONCHAIN)") ? "observé" : "NON observé (aucun composant ne pose la pause sur la chaîne)"}`);
  scene.check("montant sorti", { Paid: "aucun", cash: "100" }, { Paid: show(await paid()), cash: (await vault()).cash });

  // « Et quand » : l'agent en pause renvoie une demande saine.
  const again = await send("A-DEM-2", "PAY_INVOICE", "F-001", INVOICE);
  await sleep(1000);
  const out = await output(again.id);
  scene.check("demande saine ensuite", { http: 401, verdict: "BLOCK", journal: "AUTH_REJECTED" }, { http: again.http, verdict: out?.verdict ?? "?", journal: show(await journalLabels(again.id)) });
}

async function scene4(scene) {
  const sample = readFileSync(join(ROOT, "data", "jeu-factures", "dev.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((s) => s.id === MISSED_SAMPLE);
  if (!sample || sample.label !== "attack") throw new DemoError(`échantillon ${MISSED_SAMPLE} absent de dev.jsonl`);
  const sent = await send("A-DEM-3", "PAY_INVOICE", "F-999", sample.document);
  const seen = await settledJournal(sent.id, "INCIDENT_REPORT_GENERATED");
  await checkGateway(scene, sent, { http: 202, verdict: "PASS" });
  scene.check("contrat", ["0/INVOICE_UNKNOWN"], await decisions(sent.id));
  scene.check("Paid", [], await paid());
  scene.check("état", { cash: "100" }, { cash: (await vault()).cash });
  scene.check("réponse", { pauses: "A-DEM-3(OFFCHAIN)", incidents: "CONTRACT_REFUSAL" }, { pauses: show(await paused()), incidents: show(await incidents()) });
  scene.journal("journal", [...NOMINAL, "DECISION_OBSERVED(0,1)", "QUARANTINED", "AGENT_PAUSED(OFFCHAIN)", "ALERT_SENT(SECURITY)", "INCIDENT_REPORT_GENERATED"], seen.filter((l) => l !== "AGENT_PAUSED(ONCHAIN)"));
  scene.note(`« plus tard AGENT_PAUSED (ONCHAIN) » : ${seen.includes("AGENT_PAUSED(ONCHAIN)") ? "observé" : "NON observé (aucun composant ne pose la pause sur la chaîne)"}`);
}

async function scene5(scene) {
  const before = await vault();
  await stopService("relay");
  const sent = await send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE);
  const enqueuedAt = Date.now();
  await checkGateway(scene, sent, { http: 202, verdict: "PASS" });
  const signed = (await journal(sent.id)).find((e) => e.type === "REQUEST_SIGNED");
  const expiresAt = signed?.data.expires_at ?? Math.floor(enqueuedAt / 1000) + 30;

  // Relais arrêté : alerte de disponibilité attendue après 15 s en file.
  console.error("  scène 5 : relais arrêté, attente de l'alerte de disponibilité (15 s)…");
  const atAlert = await until(() => journalLabels(sent.id), (seen) => seen.includes("ALERT_SENT(AVAILABILITY)"), 20_000 - (Date.now() - enqueuedAt));
  const alertedWhileDown = atAlert.includes("ALERT_SENT(AVAILABILITY)");
  console.error("  scène 5 : attente de l'expiration en file…");
  const atExpiry = await until(() => journalLabels(sent.id), (seen) => seen.includes("QUEUE_EXPIRED"), Math.max(0, expiresAt * 1000 + 4000 - Date.now()));
  const expiredWhileDown = atExpiry.includes("QUEUE_EXPIRED");
  scene.check("relais arrêté", { "alerte de disponibilité à 15 s": "oui", "QUEUE_EXPIRED à l'expiration": "oui" }, { "alerte de disponibilité à 15 s": alertedWhileDown ? "oui" : "non", "QUEUE_EXPIRED à l'expiration": expiredWhileDown ? "oui" : "non" });

  // « Et quand » : le relais redémarre après l'expiration.
  await startService(service(config, "relay"));
  const seen = await settledJournal(sent.id, "ALERT_SENT(AVAILABILITY)", 15_000);
  scene.journal("journal, relais relancé", [...NOMINAL.slice(0, -1), "ALERT_SENT(AVAILABILITY)", "QUEUE_EXPIRED"], seen);
  scene.check("contrat", "non atteint, aucun événement", (await decisions(sent.id)).length === 0 && !seen.includes("SUBMITTED") ? "non atteint, aucun événement" : "atteint");
  scene.check("file", ["EXPIRED"], (await queueRows(sent.id)).map((row) => row.status));
  scene.check("état", { cash: "100", dettes: "40" }, { cash: before.cash, dettes: before.dettes });
  scene.check("état, relais relancé", { cash: "100", dettes: "40" }, (({ cash, dettes }) => ({ cash, dettes }))(await vault()));
  scene.check("réponse", { pauses: "aucun", incidents: "aucun" }, { pauses: show(await paused()), incidents: show(await incidents()) });
  if (config.mode === "fake") scene.note("en mode fake, relancer le relais recrée le faux coffre : « état, relais relancé » est celui d'un monde neuf");
}

/** Scénario 6 jusqu'au montant bloqué. Rend la demande et l'échéance (secondes). */
async function sceneSix(scene) {
  const sent = await send("A-DEM-1", "PAY_INVOICE", "F-002", INVOICE);
  const seen = await settledJournal(sent.id, "ALERT_SENT(APPROVAL_REQUESTED)");
  await checkGateway(scene, sent, { http: 202, verdict: "PASS" });
  scene.check("contrat", ["1/ABOVE_THRESHOLD"], await decisions(sent.id));
  const hold = (await events("HoldPlaced")).find((e) => e.request_id === sent.id);
  scene.check("HoldPlaced", { montant: "30", "échéance": "+30 s" }, hold ? { montant: units(hold.args.amount), "échéance": `+${hold.args.deadline - hold.block_timestamp} s` } : "aucun");
  scene.check("état", { cash: "100", dettes: "40", "bloqué": "30", "plaçable": "20" }, await vault());
  scene.journal("journal", [...NOMINAL, "DECISION_OBSERVED(1,10)", "ALERT_SENT(APPROVAL_REQUESTED)"], seen);
  return { sent, deadline: hold?.args.deadline ?? Math.floor(Date.now() / 1000) + 30 };
}

async function scene6a(scene) {
  const { sent } = await sceneSix(scene);
  scene.check("approbation avant l'échéance", "appel accepté", await human("approve", sent.id));
  const seen = await settledJournal(sent.id, "DECISION_OBSERVED(2,13)");
  scene.check("contrat, 6a", ["1/ABOVE_THRESHOLD", "2/APPROVED"], await decisions(sent.id));
  scene.check("Paid, 6a", ["30→B-002"], await paid(sent.id));
  scene.check("état, 6a", { cash: "70", dettes: "10", "bloqué": "0", "plaçable": "20" }, await vault());
  scene.journal("journal, 6a", ["DECISION_OBSERVED(2,13)"], seen, { tail: true });
}

async function scene6b(scene) {
  const { sent, deadline } = await sceneSix(scene);
  scene.check("expire avant l'échéance", "appel refusé (DeadlineNotReached)", await human("expire", sent.id));
  // Compte à rebours réel : personne ne répond jusqu'à l'échéance.
  for (let left = deadline + 2 - Math.floor(Date.now() / 1000); left > 0; left = deadline + 2 - Math.floor(Date.now() / 1000)) {
    console.error(`  scène 6b : échéance dans ${left} s, personne ne répond…`);
    await sleep(Math.min(left, 5) * 1000);
  }
  scene.check("expire après l'échéance", "appel accepté", await human("expire", sent.id));
  const seen = await settledJournal(sent.id, "DECISION_OBSERVED(0,11)");
  scene.check("contrat, 6b", ["1/ABOVE_THRESHOLD", "0/APPROVAL_TIMEOUT"], await decisions(sent.id));
  scene.check("HoldReleased, 6b", 1, (await events("HoldReleased")).filter((e) => e.request_id === sent.id).length);
  scene.check("Paid, 6b", [], await paid());
  scene.check("état, 6b", { cash: "100", dettes: "40", "bloqué": "0", "plaçable": "20" }, await vault());
  // La spec demande DECISION_OBSERVED (0, 11) à la suite ; ce qui vient après s'affiche en note.
  const after = seen.slice(seen.indexOf("ALERT_SENT(APPROVAL_REQUESTED)") + 1);
  scene.journal("journal, 6b", ["DECISION_OBSERVED(0,11)"], after.slice(0, 1));
  if (after.length > 1) scene.note(`après DECISION_OBSERVED(0,11), le journal porte aussi : ${after.slice(1).join(", ")} (specs/05 : notification à l'approbateur pour les suites d'un cas 1)`);
}

async function scene7a(scene) {
  const sent = await send("A-TRESO", "PLACE", "P-030", PLACEMENT);
  const seen = await settledJournal(sent.id, "DECISION_OBSERVED(0,6)");
  await checkGateway(scene, sent, { http: 202, verdict: "PASS" });
  scene.check("contrat", ["0/EXCEEDS_PLACEABLE"], await decisions(sent.id));
  scene.check("Paid", [], await paid());
  scene.check("état", { cash: "100", "plaçable": "20" }, (({ cash, plaçable }) => ({ cash, plaçable }))(await vault()));
  await checkNoResponse(scene);
  scene.journal("journal", [...NOMINAL, "DECISION_OBSERVED(0,6)"], seen);
}

async function scene7b(scene) {
  await scene7a(scene);
  const sent = await send("A-TRESO", "PLACE", "P-020", PLACEMENT);
  const seen = await settledJournal(sent.id, "DECISION_OBSERVED(2,0)");
  await checkGateway(scene, sent, { http: 202, verdict: "PASS" }, "porte, P-020");
  scene.check("contrat, P-020", ["2/NONE"], await decisions(sent.id));
  scene.check("Paid, P-020", ["20→B-PLACEMENT"], await paid(sent.id));
  scene.check("état, P-020", { cash: "80", "plaçable": "0" }, (({ cash, plaçable }) => ({ cash, plaçable }))(await vault()));
  scene.journal("journal, P-020", [...NOMINAL, "DECISION_OBSERVED(2,0)"], seen);
}

async function scene8(scene) {
  // « Étant donné le scénario 1 joué » : R1 paie F-001.
  const first = new Scene("1", "");
  const r1 = await scene1(first);
  scene.check("scénario 1 d'abord", "F-001 payée par R1", first.checks.find((c) => c.point === "Paid")?.ok ? "F-001 payée par R1" : "F-001 non payée");

  // 8 a : la demande signée R1 est remise en file telle quelle.
  const replay = run(process.execPath, ["--disable-warning=ExperimentalWarning", "src/demo-replay.ts", r1.id], { cwd: join(ROOT, "relay"), env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...queueEnv(config), DEMO_MODE: "1" } });
  scene.check("8a, remise en file de R1", "acceptée", replay.status === 0 ? "acceptée" : `refusée (${replay.stdout.trim() || replay.stderr.trim().split("\n").at(-1)})`);
  const replayed = await settledJournal(r1.id, "DECISION_OBSERVED(0,3)");
  scene.check("8a, relais", ["SUBMITTED", "SUBMITTED"], (await queueRows(r1.id)).map((row) => row.status));
  scene.check("8a, contrat", ["2/NONE", "0/REQUEST_REPLAYED"], await decisions(r1.id));
  scene.journal("8a, journal", ["ENQUEUED", "SUBMITTED", "DECISION_OBSERVED(0,3)"], replayed, { tail: true });

  // 8 b : A-DEM-1 transmet de nouveau F-001, nouvelle demande R2.
  const r2 = await send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE);
  const seen = await settledJournal(r2.id, "DECISION_OBSERVED(0,2)");
  const out = await output(r2.id);
  // Les deux sont acceptés par la spec : PASS, ou blocage PAYMENT_ANOMALY.
  const blocked = out?.verdict === "BLOCK" && out.reason_codes.includes("PAYMENT_ANOMALY");
  scene.checks.push({ point: "8b, porte", expected: "PASS, ou PAYMENT_ANOMALY", observed: show({ http: r2.http, verdict: out?.verdict ?? "?", score: out?.score ?? "null", codes: show(out?.reason_codes ?? []) }), ok: out?.verdict === "PASS" || blocked });
  if (!blocked) {
    scene.check("8b, contrat", ["0/INVOICE_ALREADY_PAID"], await decisions(r2.id));
    scene.journal("8b, journal", [...NOMINAL, "DECISION_OBSERVED(0,2)"], seen);
  }
  scene.check("état", { cash: "90" }, { cash: (await vault()).cash });
  scene.check("Paid, total", ["10→B-001"], await paid());
  await checkNoResponse(scene);
}

const SCENES = [
  ["1", "facture légitime", scene1],
  ["2", "agent non reconnu", scene2],
  ["3", "facture piégée, détectée", scene3],
  ["4", "facture piégée, non détectée", scene4],
  ["5", "relais en panne", scene5],
  ["6a", "au-dessus du seuil, approuvée", scene6a],
  ["6b", "au-dessus du seuil, délai dépassé", scene6b],
  ["7a", "placement trop élevé", scene7a],
  ["7b", "placement trop élevé, puis dans la limite", scene7b],
  ["8", "rejeu et double paiement", scene8],
];

// --- Lancement -----------------------------------------------------------------

function print(scene) {
  const verdict = scene.gaps.length === 0 ? "OK" : "ÉCART";
  const side = (key) => scene.checks.map((c) => `${c.point} : ${c[key]}`).join(" · ");
  console.log(`scène ${scene.id} (${scene.title}) | attendu — ${side("expected")} | observé — ${side("observed")} | ${verdict}`);
  for (const gap of scene.gaps) console.log(`    ÉCART ${scene.id}, ${gap.point} : attendu ${gap.expected} ; observé ${gap.observed}`);
  for (const note of scene.notes) console.log(`    note ${scene.id} : ${note}`);
}

async function main(argv) {
  const jsonAt = argv.indexOf("--json");
  const jsonFile = jsonAt === -1 ? null : argv[jsonAt + 1];
  const wanted = argv.filter((arg, i) => arg !== "--json" && (jsonAt === -1 || i !== jsonAt + 1));
  const unknown = wanted.filter((id) => !SCENES.some(([known]) => known === id));
  if (unknown.length > 0 || (jsonAt !== -1 && jsonFile === undefined)) {
    console.error(`usage : node demo/scenes.mjs [scène…] [--json <fichier>]\nscènes : ${SCENES.map(([id]) => id).join(" ")}`);
    return 64;
  }
  if (process.env.DEMO_MODE !== "1") throw new DemoError("les scènes remettent la démo à zéro : DEMO_MODE=1 exigé (make scenes)");
  const down = (await status(config)).filter((row) => row.service !== "dashboard" && row.state !== "prêt" && row.state !== "ouvert");
  if (down.length > 0) throw new DemoError(`services non prêts (${down.map((row) => row.service).join(", ")}) : make demo d'abord`);

  console.log(`scènes : VAULT_MODE=${config.mode}${config.mode === "fake" ? " — COFFRE SIMULÉ : aucun fonds, aucune chaîne" : ""}, détecteur réel, journal réel`);
  const played = [];
  for (const [id, title, play] of SCENES) {
    if (wanted.length > 0 && !wanted.includes(id)) continue;
    const scene = new Scene(id, title);
    try {
      await reset(config, { chain: bringUpChain, quiet: true });
      await play(scene);
    } catch (error) {
      // Une scène qui ne va pas au bout est un écart, pas un silence.
      scene.checks.push({ point: "déroulement", expected: "scène jouée jusqu'au bout", observed: `interrompue : ${error instanceof Error ? error.message.split("\n")[0] : "erreur"}`, ok: false });
    }
    print(scene);
    played.push(scene);
  }
  const gaps = played.reduce((n, scene) => n + scene.gaps.length, 0);
  console.log(`\n${played.length} scène(s), ${played.filter((s) => s.gaps.length === 0).length} OK, ${played.filter((s) => s.gaps.length > 0).length} avec écart (${gaps} écart(s) au total)`);
  if (jsonFile) writeFileSync(jsonFile, JSON.stringify(played.map((s) => ({ id: s.id, checks: s.checks, notes: s.notes })), null, 2), "utf8");
  return gaps === 0 ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof DemoError)) throw error;
  console.error(`scènes : ${error.message}`);
  process.exitCode = 1;
}
