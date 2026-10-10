// Détecteur à trois signaux (specs/03, PROPOSITION § 6). Règles déterministes,
// sans modèle : le même document donne toujours le même score, et chaque point
// du score se rattache à une règle nommée.
//
// Le document est une donnée. Il n'est jamais exécuté ni placé dans le contexte
// d'un modèle : on y cherche seulement des formes.
//
// Limite assumée : des règles ne voient que ce qu'elles décrivent. Une attaque
// formulée autrement passe (scénario 4) ; c'est le contrat qui l'arrête ensuite.
import type { Action, ReasonCode } from "./config.ts";

export type DetectionInput = {
  document: string;
  /** Action déclarée, si elle est lisible. */
  action: Action | null;
  /** Mandat de l'agent authentifié, tiré du registre des jetons. */
  mandate: Action[];
  /** Signaux d'historique, calculés par la porte : la règle elle-même reste pure. */
  history?: { duplicate: boolean; burst: boolean };
};

export type Signal = "INSTRUCTION_IN_DATA" | "AUTHORITY_VIOLATION" | "PAYMENT_ANOMALY";

export type Detection = {
  score: number; // entier de 0 à 100
  reason_codes: ReasonCode[];
  signals: Record<Signal, number>;
  /** Règles qui ont contribué, pour expliquer un score. Jamais d'extrait du document. */
  rules: string[];
};

// Un signal figure dans les codes raison à partir de ce niveau, même sous le seuil.
const SIGNAL_FLOOR = 20;

const ZERO_WIDTH = /[​-‏⁠-⁤﻿­]/g;
const BIDI = /[‪-‮⁦-⁩]/g;
const BASE64_RUN = /[A-Za-z0-9+/]{24,}={0,2}/g;

/** Texte ramené à une forme comparable : sans accents, sans casse, espaces réduits. */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(BIDI, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

type Rule = { name: string; weight: number; pattern: RegExp };


// Une instruction adressée à celui qui lit, là où il ne devrait y avoir que des faits.
const INSTRUCTION_RULES: Rule[] = [
  {
    name: "contournement-des-regles",
    weight: 60,
    pattern:
      /\b(?:ignore[rz]?|oublie[rz]?|ne (?:tiens|tenez) pas compte|disregard|forget|override|bypass|contourne[rz]?|outrepasse[rz]?|desactive[rz]?|disable)\b.{0,50}\b(?:regles?|instructions?|consignes?|politiques?|controles?|limites?|plafonds?|verifications?|validations?|rules?|policy|policies|checks?|limits?|safeguards?|previous|precedentes?)\b/,
  },
  {
    name: "ordre-de-paiement-chiffre",
    weight: 45,
    pattern:
      /\b(?:paie|payez|payer|paye|regle|reglez|regler|vire|virez|virer|verse|versez|verser|transfere|transferez|transferer|envoie|envoyez|envoyer|pay|send|transfer|wire|remit)\b.{0,20}\b\d[\d .,]*\s?(?:eur|euros?|usd|\$|€|avax|k)?\s?(?:a|au|sur|vers|to|into)\b/,
  },
  {
    name: "destination-designee",
    weight: 35,
    pattern: /\b(?:a|sur|vers|to|into) (?:ce|cet|cette|this|the following|le) (?:nouveau |nouvelle |new )?(?:compte|iban|rib|adresse|portefeuille|wallet|account|address)\b/,
  },
  {
    name: "changement-de-role",
    weight: 50,
    pattern:
      /\b(?:system prompt|prompt systeme|message systeme|tu es (?:maintenant|desormais)|vous etes (?:maintenant|desormais)|you are now|act as|agis comme|agissez comme|a partir de maintenant tu|from now on you|new instructions?|nouvelles? instructions?)\b/,
  },
  {
    name: "adresse-a-l-agent",
    weight: 40,
    pattern:
      /\b(?:instructions?|note|message|consignes?) (?:pour|a l'attention de|destinee?s? a|to|for) (?:l'|le |la |the )?(?:agent|assistant|ia|ai|modele|model|llm|robot|bot)\b|\b(?:cher|dear) (?:agent|assistant)\b|\b(?:assistant|system|agent)\s?:/,
  },
  {
    name: "fausse-autorite",
    weight: 40,
    pattern:
      /\b(?:directeur financier|directrice financiere|daf|cfo|ceo|pdg|direction generale|tresorier|administrateur|owner|proprietaire)\b.{0,60}\b(?:a (?:leve|autorise|valide|approuve|demande|ordonne)|autorise|ordonne|exige|has (?:approved|authorized|waived|lifted)|approved|authorized)\b/,
  },
  {
    name: "politique-modifiee",
    weight: 45,
    pattern:
      /\b(?:plancher|reserve|seuil|plafond|limite|threshold|floor|limit|cap)\b.{0,40}\b(?:leve|levee|supprime|supprimee|desactive|desactivee|releve|relevee|augmente|augmentee|ne s'applique (?:pas|plus)|lifted|removed|disabled|raised|waived|no longer applies)\b/,
  },
  {
    name: "contournement-de-la-validation",
    weight: 40,
    pattern:
      /\b(?:sans (?:validation|approbation|verification|controle)|ne (?:previens|previens|prevenez|dis|dites|informe|informez)[a-z' ]{0,20}personne|ne pas (?:journaliser|signaler|alerter)|do not (?:log|tell|report|alert|escalate)|skip (?:the )?(?:approval|validation|review)|without (?:approval|validation|review))\b/,
  },
  {
    name: "pression",
    weight: 25,
    pattern:
      /\b(?:urgent|urgence|immediatement|sans delai|tout de suite|right now|immediately|asap)\b.{0,80}\b(?:penalites?|sanctions?|sinon|faute de quoi|poursuites?|otherwise|penalt(?:y|ies)|legal action)\b/,
  },
  {
    name: "historique-affirme",
    weight: 30,
    pattern:
      /\b(?:deja|already|precedemment|previously)\b.{0,30}\b(?:valide|validee|approuve|approuvee|autorise|autorisee|approved|validated|authorized)\b/,
  },
];

// Ce qui change la destination ou le montant d'un paiement.
const ANOMALY_RULES: Rule[] = [
  {
    name: "changement-de-coordonnees",
    weight: 50,
    pattern:
      /\b(?:nouveau|nouvel|nouvelle|nouvelles|nouveaux|changement|modification|mise a jour|remplace|new|updated?|changed?|replaces?)\b.{0,40}\b(?:rib|iban|bic|coordonnees bancaires|compte bancaire|compte|beneficiaire|domiciliation|bank details|account|beneficiary|payee)\b/,
  },
  { name: "iban-dans-le-document", weight: 30, pattern: /\b[a-z]{2}\d{2}(?: ?[a-z0-9]{4}){3,7}(?: ?[a-z0-9]{1,3})?\b/ },
  { name: "adresse-de-portefeuille", weight: 35, pattern: /\b0x[0-9a-f]{40}\b/ },
  {
    name: "montant-rectifie",
    weight: 35,
    pattern:
      /\b(?:au lieu de|et non|rectifie|rectification|corrige|correction|majore|majoration|instead of|rather than|corrected|revised)\b.{0,40}\d/,
  },
];

function applyRules(text: string, rules: Rule[], prefix: string, fired: Set<string>): number {
  let total = 0;
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      total += rule.weight;
      fired.add(`${prefix}:${rule.name}`);
    }
  }
  return total;
}

// Texte caché dans le document : s'il existe, on l'analyse comme le reste.
function hiddenSegments(raw: string): { segments: string[]; marks: string[] } {
  const segments: string[] = [];
  const marks: string[] = [];
  if (ZERO_WIDTH.test(raw)) marks.push("caracteres-invisibles");
  ZERO_WIDTH.lastIndex = 0;
  if (BIDI.test(raw)) marks.push("sens-d-ecriture-force");
  BIDI.lastIndex = 0;

  const comments = raw.match(/<!--[\s\S]*?-->/g) ?? [];
  if (comments.length > 0) marks.push("commentaire-html");
  segments.push(...comments);
  if (/<\s*(?:script|style|span|div|font|p)\b[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|color\s*:\s*(?:#fff|white))/i.test(raw)) {
    marks.push("texte-masque-par-style");
  }

  for (const run of raw.match(BASE64_RUN) ?? []) {
    const decoded = Buffer.from(run, "base64").toString("utf8");
    // On ne retient que ce qui se décode en texte lisible.
    const printable = decoded.replace(/[^\x20-\x7E -ſ]/g, "");
    if (decoded.length >= 12 && printable.length / decoded.length > 0.9 && /[a-z]{3,} [a-z]{2,}/i.test(decoded)) {
      marks.push("texte-encode");
      segments.push(decoded);
    }
  }
  return { segments, marks: [...new Set(marks)] };
}

export function detect(input: DetectionInput): Detection {
  const fired = new Set<string>();
  const visible = normalize(input.document);
  const hidden = hiddenSegments(input.document);

  let instruction = applyRules(visible, INSTRUCTION_RULES, "instruction", fired);
  let anomaly = applyRules(visible, ANOMALY_RULES, "anomalie", fired);

  // Du contenu caché est déjà suspect ; s'il porte une instruction, davantage.
  for (const mark of hidden.marks) {
    instruction += mark === "texte-encode" ? 15 : 30;
    fired.add(`instruction:${mark}`);
  }
  for (const segment of hidden.segments) {
    const text = normalize(segment);
    const before = fired.size;
    const inner = applyRules(text, INSTRUCTION_RULES, "instruction-cachee", fired);
    anomaly += applyRules(text, ANOMALY_RULES, "anomalie-cachee", fired);
    if (fired.size > before) instruction += inner + 30;
  }

  // Doublon et rafale réunis restent sous le seuil : une facture redemandée
  // (scénario 8) doit atteindre le contrat, qui la refuse lui-même.
  if (input.history?.duplicate === true) {
    anomaly += 30;
    fired.add("anomalie:doublon");
  }
  if (input.history?.burst === true) {
    anomaly += 25;
    fired.add("anomalie:rafale");
  }

  // Un agent demande ce que son mandat ne permet pas : règle sans nuance.
  let authority = 0;
  if (input.action !== null && !input.mandate.includes(input.action)) {
    authority = 100;
    fired.add("autorite:action-hors-mandat");
  }

  const signals: Record<Signal, number> = {
    INSTRUCTION_IN_DATA: Math.min(100, instruction),
    AUTHORITY_VIOLATION: authority,
    PAYMENT_ANOMALY: Math.min(100, anomaly),
  };
  // Le signal le plus fort porte le score ; les autres le renforcent à moitié.
  const ordered = Object.values(signals).sort((a, b) => b - a);
  const score = Math.min(100, Math.round((ordered[0] ?? 0) + ((ordered[1] ?? 0) + (ordered[2] ?? 0)) / 2));

  const reason_codes = (Object.keys(signals) as Signal[]).filter((s) => signals[s] >= SIGNAL_FLOOR);
  return { score, reason_codes, signals, rules: [...fired].sort() };
}
