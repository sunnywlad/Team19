// Banc de mesure du détecteur.
//
//   npm run bench -- <jeu.jsonl> [--threshold n] [--json]
//
// Une ligne du jeu, en JSON :
//   { "id": "…", "label": "legit" | "attack", "family": "…",
//     "action": "PAY_INVOICE" | "PLACE", "mandate": ["PAY_INVOICE"], "document": "…" }
//
// Un tiers du jeu sert au réglage du seuil, le reste à la mesure
// (PROPOSITION § 6). La répartition dépend de l'identifiant seul : elle est la
// même à chaque lancement. Les chiffres valent pour ce jeu synthétique, pas
// pour le monde réel.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ACTIONS, DEFAULT_POLICY } from "./config.ts";
import type { Action } from "./config.ts";
import { detect } from "./detector.ts";

export type Sample = { id: string; label: "legit" | "attack"; family: string; action: Action; mandate: Action[]; document: string };

export type Metrics = {
  threshold: number;
  samples: number;
  attacks: number;
  legit: number;
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  true_negatives: number;
  recall: number | null;
  precision: number | null;
  false_positive_rate: number | null;
};

export type BenchReport = {
  detector_version: string;
  tuning: { samples: number; by_threshold: Metrics[] };
  test: Metrics & {
    recall_by_family: Record<string, { attacks: number; detected: number }>;
    missed_attack_ids: string[];
    false_positive_ids: string[];
    detection_ms: { mean: number; max: number };
  };
};

export function parseDataset(text: string): Sample[] {
  const samples: Sample[] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const where = `ligne ${index + 1}`;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`${where} : JSON illisible`);
    }
    const mandate = raw["mandate"];
    if (
      typeof raw["id"] !== "string" ||
      (raw["label"] !== "legit" && raw["label"] !== "attack") ||
      typeof raw["family"] !== "string" ||
      !ACTIONS.includes(raw["action"] as Action) ||
      !Array.isArray(mandate) ||
      !mandate.every((a) => ACTIONS.includes(a as Action)) ||
      typeof raw["document"] !== "string"
    ) {
      throw new Error(`${where} : champs attendus id, label, family, action, mandate, document`);
    }
    if (seen.has(raw["id"])) throw new Error(`${where} : identifiant en double`);
    seen.add(raw["id"]);
    samples.push(raw as unknown as Sample);
  });
  return samples;
}

/** Vrai pour le tiers du jeu réservé au réglage. */
export function isTuning(id: string): boolean {
  return parseInt(createHash("sha256").update(id, "utf8").digest("hex").slice(0, 8), 16) % 3 === 0;
}

const ratio = (a: number, b: number): number | null => (b === 0 ? null : Math.round((a / b) * 10_000) / 10_000);

function measure(scored: { sample: Sample; score: number }[], threshold: number): Metrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const { sample, score } of scored) {
    const blocked = score >= threshold;
    if (sample.label === "attack") blocked ? (tp += 1) : (fn += 1);
    else blocked ? (fp += 1) : (tn += 1);
  }
  return {
    threshold,
    samples: scored.length,
    attacks: tp + fn,
    legit: fp + tn,
    true_positives: tp,
    false_positives: fp,
    false_negatives: fn,
    true_negatives: tn,
    recall: ratio(tp, tp + fn),
    precision: ratio(tp, tp + fp),
    false_positive_rate: ratio(fp, fp + tn),
  };
}

export function runBench(samples: Sample[], threshold: number = DEFAULT_POLICY.threshold): BenchReport {
  const durations: number[] = [];
  const scored = samples.map((sample) => {
    const start = performance.now();
    // Le banc mesure les règles seules, sans historique de la porte.
    const { score } = detect({ document: sample.document, action: sample.action, mandate: sample.mandate });
    durations.push(performance.now() - start);
    return { sample, score };
  });
  const tuning = scored.filter((s) => isTuning(s.sample.id));
  const test = scored.filter((s) => !isTuning(s.sample.id));

  const families: Record<string, { attacks: number; detected: number }> = {};
  for (const { sample, score } of test) {
    if (sample.label !== "attack") continue;
    const family = (families[sample.family] ??= { attacks: 0, detected: 0 });
    family.attacks += 1;
    if (score >= threshold) family.detected += 1;
  }
  const round = (n: number): number => Math.round(n * 1000) / 1000;

  return {
    detector_version: DEFAULT_POLICY.detectorVersion,
    tuning: { samples: tuning.length, by_threshold: [30, 40, 50, 60, 70, 80, 90].map((t) => measure(tuning, t)) },
    test: {
      ...measure(test, threshold),
      recall_by_family: families,
      missed_attack_ids: test.filter((s) => s.sample.label === "attack" && s.score < threshold).map((s) => s.sample.id),
      false_positive_ids: test.filter((s) => s.sample.label === "legit" && s.score >= threshold).map((s) => s.sample.id),
      detection_ms: {
        mean: round(durations.reduce((a, b) => a + b, 0) / Math.max(durations.length, 1)),
        max: round(Math.max(0, ...durations)),
      },
    },
  };
}

const pct = (value: number | null): string => (value === null ? "n/a" : `${(value * 100).toFixed(1)} %`);

export function renderReport(report: BenchReport): string {
  const t = report.test;
  const lines = [
    `Détecteur ${report.detector_version}`,
    "",
    `Réglage (${report.tuning.samples} échantillons) : seuil -> rappel, précision, faux positifs`,
    ...report.tuning.by_threshold.map((m) => `  ${m.threshold} -> ${pct(m.recall)}, ${pct(m.precision)}, ${m.false_positives}`),
    "",
    `Mesure au seuil ${t.threshold} (${t.samples} échantillons : ${t.attacks} attaques, ${t.legit} légitimes)`,
    `  rappel            ${pct(t.recall)}  (${t.true_positives} détectées, ${t.false_negatives} manquées)`,
    `  précision         ${pct(t.precision)}`,
    `  faux positifs     ${t.false_positives} sur ${t.legit}  (${pct(t.false_positive_rate)})`,
    `  temps de détection  moyenne ${t.detection_ms.mean} ms, maximum ${t.detection_ms.max} ms`,
    "",
    "Rappel par famille :",
    ...Object.entries(t.recall_by_family).map(([family, f]) => `  ${family} : ${f.detected} sur ${f.attacks}`),
    "",
    `Attaques manquées : ${t.missed_attack_ids.length === 0 ? "aucune" : t.missed_attack_ids.join(", ")}`,
    `Faux positifs : ${t.false_positive_ids.length === 0 ? "aucun" : t.false_positive_ids.join(", ")}`,
  ];
  return lines.join("\n");
}

function main(argv: string[]): number {
  let file: string | undefined;
  let threshold = DEFAULT_POLICY.threshold;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--json") json = true;
    else if (arg === "--threshold") {
      const value = Number(argv[(i += 1)]);
      if (!Number.isInteger(value) || value < 0 || value > 100) return usage();
      threshold = value;
    } else if (arg.startsWith("--") || file !== undefined) return usage();
    else file = arg;
  }
  if (file === undefined) return usage();
  let samples: Sample[];
  try {
    samples = parseDataset(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`jeu illisible : ${(error as Error).message}`);
    return 2;
  }
  const report = runBench(samples, threshold);
  console.log(json ? JSON.stringify(report, null, 2) : renderReport(report));
  return 0;
}

function usage(): number {
  console.error("usage : bench <jeu.jsonl> [--threshold n] [--json]");
  return 64;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
