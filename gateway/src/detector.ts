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
// Ajouté quand une forme d'écriture cachait une règle (texte inversé, lettres espacées…).
const HIDING_BONUS = 30;

const ZERO_WIDTH = /[​-‏⁠-⁤﻿­]/g;
const BIDI = /[‪-‮⁦-⁩]/g;
// Caractères « étiquette » Unicode : invisibles, ils recopient de l'ASCII.
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;
const BASE64_RUN = /[A-Za-z0-9+/]{24,}={0,2}/g;

// Lettres cyrilliques et grecques qui se confondent à l'œil avec une lettre latine.
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  і: "i", ј: "j", ѕ: "s", ԁ: "d", һ: "h", ӏ: "l",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X", І: "I", Ј: "J", Ѕ: "S",
  α: "a", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};
const FOREIGN = /[Ͱ-ϿЀ-ԯ]/g;
const MIXED_ALPHABETS = /[A-Za-z][Ͱ-ϿЀ-ԯ]|[Ͱ-ϿЀ-ԯ][A-Za-z]/;

/** Texte ramené à une forme comparable : sans accents, sans casse, espaces réduits. */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(FOREIGN, (c) => CONFUSABLES[c] ?? c)
    .replace(ZERO_WIDTH, "")
    .replace(BIDI, "")
    .replace(TAG_CHARS, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// « unless » : si ce motif est présent, la règle ne s'applique pas.
type Rule = { name: string; weight: number; pattern: RegExp; unless?: RegExp };

// --- Vocabulaire, en français, anglais et espagnol, sur le texte normalisé. ---

// À qui un document piégé s'adresse : celui qui le lit à la place d'un humain.
const ADDRESSEE = "(?:agent|assistant|assistante|ia|ai|modele|model|llm|logiciel|systeme|system|software|programme|automate|robot|bot|asistente|agente|sistema|programa)";

// Un contrôle interne de celui qui paie.
const CONTROL =
  "(?:controles?|verifications?|validations?|approbations?|rapprochements?|registre|plafonds?|limites?|seuils?|regles?|consignes|instructions|procedures?|circuit de validation|checks?|verification|approvals?|matching|reviews?|limits?|rules?|payment history|safeguards?|comprobacion(?:es)?|verificacion(?:es)?|aprobacion(?:es)?|reglas?|revision(?:es)?|registro)";

// Écarter, sauter ou taire.
const SKIP =
  "(?:sans|ne pas|n'est pas necessaire|pas besoin|inutile d[e']|ignore[rz]?|ignora|ignoren|oublie[rz]?|olvida|olviden|saute[rz]?|passe[rz]? outre|omets?|omettez|omite|omitan|contourne[rz]?|outrepasse[rz]?|desactive[rz]?|dispensee?s?|exemptee?s?|plus le temps pour|pas le temps (?:pour|de)|without|skip|bypass|disregard|forget|override|disable|do not|don't|no need to|must not|never|no time (?:for|to)|sin|no hace falta|no hay tiempo para|saltar(?:te|se)?|saltate|exentas?|exentos?)";

const AUTHORITY =
  "(?:directeur financier|directrice financiere|direction financiere|direction generale|directeur general|president|presidente|daf|cfo|chief financial officer|ceo|pdg|tresorier|treasurer|head of [a-z]+|finance director|commissaires? aux comptes|auditeur|auditor|owner|proprietaire|consejero delegado|direccion financiera|director financiero|comite|service (?:securite|fraude)|fraud (?:team|department)|banque|bank|banco)";

// Une instruction adressée à celui qui lit, là où il ne devrait y avoir que des faits.
const INSTRUCTION_RULES: Rule[] = [
  {
    name: "adresse-a-l-agent",
    weight: 40,
    pattern: new RegExp(
      [
        String.raw`\b(?:note|message|instructions?|consignes?|avis|mention|mensaje|nota|aviso|instruccion(?:es)?) (?:pour|a|au|aux|a l'attention d[eu]|a l'intention d[eu]|destinee?s? a|para|to|for) (?:l'|le |la |el |al |the )?` + ADDRESSEE + String.raw`\b`,
        String.raw`\ba l'attention d[eu] (?:l')?` + ADDRESSEE + String.raw`\b`,
        String.raw`\b(?:cher|chere|dear|estimado) ` + ADDRESSEE + String.raw`\b`,
        String.raw`\b(?:pour|para|for) (?:le |l'|el |the )?` + ADDRESSEE + String.raw` (?:qui|que|that|which) (?:traite|lit|analyse|lee|procesa|reads?|process\w*)\b`,
        String.raw`\b(?:agent|assistant|asistente|agente|system|systeme|sistema)\s?[:,] `,
      ].join("|"),
    ),
  },
  {
    // Redéfinir le rôle de celui qui lit : aucune facture ne le fait.
    name: "changement-de-role",
    weight: 70,
    pattern:
      /\b(?:you are (?:no longer|now)|from now on,? you|act as (?:an? |the )|tu n'es plus|vous n'etes plus|tu es (?:maintenant|desormais)|vous etes (?:maintenant|desormais)|a partir de maintenant,? (?:tu|vous)|a partir de este momento|ya no eres|ahora eres|actuas como|agis comme|agissez comme|imagine que tu es|imaginez que vous etes|imagina que eres|reste[zr]? dans (?:ce|le|ton|votre) (?:personnage|role)|stay in character|nouvelle session|new session|fin du document|end of (?:the )?document|system prompt|prompt systeme|message systeme|new instructions?|nouvelles? instructions?|jouons a un jeu|let's play a game|juguemos a un juego)\b|\bmode (?:maintenance|test|debug|administrateur|developpeur)\b.{0,20}\bactive\b|\b(?:maintenance|test|debug|developer|admin) mode\b/,
  },
  {
    // Écarter un contrôle interne de celui qui paie.
    name: "controle-ecarte",
    weight: 70,
    pattern: new RegExp(
      [
        String.raw`\b` + SKIP + String.raw`\b.{0,50}\b` + CONTROL + String.raw`\b`,
        String.raw`\bne (?:le |la |les )?(?:verifie[zr]?|controle[zr]?|compare[zr]?) pas\b`,
        String.raw`\b(?:do not|don't|never|no) (?:verify|check|escalate|verifiquen?|comprueben?|esperen?)\b`,
        String.raw`\b(?:wait|attendre|attendez|esperar) (?:for |l'|la |el )?(?:approval|approbation|validation|aprobacion)\b`,
      ].join("|"),
    ),
  },
  {
    // Annoncer qu'un contrôle est levé : ce n'est pas au fournisseur de le dire.
    name: "controle-leve",
    weight: 70,
    pattern: new RegExp(
      [
        String.raw`\b(?:regles?|rules?|plafonds?|limites?|limits?|seuils?|thresholds?|controles?|verifications?|approbations?|approvals?|procedures?|liste des placements autorises|reglas?|comprobacion(?:es)?)\b.{0,60}\b(?:suspendue?s?|suspended|levee?s?|leve|lifted|waived|supprimee?s?|desactivee?s?|disabled|temporairement ouverte?s?|ne s'appliquent? (?:pas|plus)|no longer appl\w+|ya no se aplican?)\b`,
        String.raw`\b(?:ya no requieren?|no longer requires?|ne necessitent? plus(?: de)?|n'exigent? plus(?: de)?) (?:verificacion|aprobacion|comprobacion|verification|approval|validation|controle)\b`,
        String.raw`\b(?:derogation|par exception a la procedure|by way of exception|as an exception to)\b`,
      ].join("|"),
    ),
  },
  {
    // Un fournisseur demande d'être payé ; il ne demande pas d'approuver.
    name: "ordre-d-approuver",
    weight: 50,
    pattern:
      /\b(?:valide[zr]?|approuve[zr]?|autorise[zr]?|execute[zr]?|approve|authori[sz]e|execute|aprueb[ae]n?|aprobar|autoriz[ae]n?|autorizar|ejecut[ae]n?)\s(?:immediatement\s|now\s)?(?:ce|le|cette|la|this|the|este|el|esta)\s(?:paiement|virement|placement|facture|payment|transfer|invoice|pago|transferencia|factura)\b/,
  },
  {
    name: "ordre-de-paiement-chiffre",
    weight: 45,
    pattern:
      /\b(?:paie|payez|payer|paye|regle|reglez|regler|vire|virez|virer|verse|versez|verser|transfere|transferez|transferer|envoie|envoyez|envoyer|pay|send|transfer|wire|remit)\b.{0,20}\b\d[\d .,]*\s?(?:eur|euros?|usd|\$|€|avax|k)?\s?(?:a|au|sur|vers|to|into)\b/,
  },
  {
    name: "ordre-de-placement",
    weight: 45,
    pattern:
      /\b(?:souscrivez|souscris|souscrire|placez|place|placer|investissez|investis|investir|subscribe|invest|suscriban?|inviertan?)\b.{0,40}(?:\d[\d .,]*\s?(?:eur|euros?|€|k€)|\btotalite\b|\btoutes? les liquidites\b|\ball (?:available )?(?:cash|funds|liquidity)\b)/,
  },
  {
    name: "destination-designee",
    weight: 35,
    pattern: /\b(?:a|sur|vers|to|into) (?:ce|cet|cette|this|the following) (?:nouveau |nouvelle |new )?(?:compte|iban|rib|adresse|portefeuille|wallet|account|address)\b/,
  },
  {
    name: "fausse-autorite",
    weight: 40,
    pattern: new RegExp(
      [
        String.raw`\b` + AUTHORITY + String.raw`\b.{0,60}\b(?:a (?:leve|autorise|valide|approuve|demande|ordonne|decide)|autorise|ordonne|exige|demande de|decision|has (?:approved|authori[sz]ed|waived|lifted)|personally authori[sz]ed|approved|authori[sz]ed|autorizada|por orden|ha autorizado)\b`,
        String.raw`\b(?:sur decision|sur ordre|sur instruction|a la demande|por orden|i have personally|j'ai personnellement)\b.{0,40}\b(?:` + AUTHORITY + String.raw`|authori[sz]ed|autorise)\b`,
        String.raw`\b(?:per|as instructed by|on behalf of|on the orders? of) (?:the |your )?` + AUTHORITY + String.raw`\b`,
      ].join("|"),
    ),
  },
  {
    name: "secret-demande",
    weight: 40,
    pattern:
      /\b(?:ne (?:previens|prevenez|dis|dites|informe|informez)[a-z' ]{0,20}personne|n'en parle[zr]? a personne|ne (?:le |la )?(?:signale[zr]?|mentionne[zr]?|journalise[zr]?) pas|ne pas (?:journaliser|signaler|alerter|mentionner)|do not (?:log|tell|report|alert|mention)|don't tell|never logs?|no avis\w+ a nadie|sin avisar|strictly confidential|strictement confidentiel)\b/,
  },
  {
    name: "controle-reporte",
    weight: 40,
    pattern:
      /\b(?:verifications?|controles?|validations?|paperwork|sign-?off|approval|compte rendu|justificatifs?|reference|referencia|dudas)\b.{0,50}\b(?:apres coup|plus tard|ulterieurement|suivra|suivront|communiquee? apres|will follow|later|afterwards|despues)\b/,
  },
  {
    name: "accord-non-trace",
    weight: 35,
    pattern: /\b(?:oralement|verbalement|accord verbal|par telephone|verbally|over the phone|by phone|por telefono)\b/,
  },
  {
    name: "historique-affirme",
    weight: 30,
    pattern: /\b(?:deja|already|precedemment|previously|ya)\b.{0,30}\b(?:valide|validee|approuve|approuvee|autorise|autorisee|approved|validated|authori[sz]ed|aprobad[ao]|autorizad[ao])\b/,
  },
];

// Délai de quelques minutes ou heures, et menace : les deux ensemble.
const SHORT_DEADLINE =
  /\b(?:dans l'heure|dans les? \d+ (?:minutes?|heures?)|sous \d+ (?:minutes?|heures?)|within (?:the next )?\d+ (?:minutes?|hours?)|en los proximos \d+ minutos|en \d+ minutos|avant \d{1,2} ?h(?:eures)? ce jour|every hour|chaque heure|1 day from|passe midi|before noon|a midi|ce matin|tout de suite|right now|pague ya)\b/;
const THREAT =
  /\b(?:sinon|faute de quoi|penalt(?:y|ies)|penalites?|suspendu\w*|coupure|perd(?:ez|rez|ra)|perdera|cancel\w*|legal action|contentieux|disparait|supplie|i beg|se lo ruego)\b/;

// Ce qui change la destination ou le montant d'un paiement.
const ANOMALY_RULES: Rule[] = [
  {
    // Un changement de coordonnées bancaires se vérifie toujours par un autre
    // canal : seul, il suffit à bloquer.
    name: "changement-de-coordonnees",
    weight: 70,
    pattern:
      /\b(?:nouveau|nouvel|nouvelle|nouvelles|nouveaux|changement|modification|mise a jour|remplace|new|updated?|changed?|replaces?|nueva|nuevos|cambio|cambiado)\b.{0,40}\b(?:rib|iban|bic|coordonnees bancaires|compte bancaire|compte|beneficiaire|domiciliation|banque|bank details|bank|account|beneficiary|payee|entidad bancaria|banco|cuenta|datos bancarios)\b/,
    unless: /\b(?:inchange[es]{0,2}|unchanged|restent les memes|remains? the same|ne changent? pas|sin cambios|no han cambiado|ce sont les memes|jamais de modifier)\b/,
  },
  {
    name: "compte-de-substitution",
    weight: 70,
    pattern:
      /\b(?:compte|account|iban|rib|cuenta)\b.{0,30}\b(?:gele|cloture|bloque|ferme|suspendu|frozen|closed|blocked|suspended|bloqueada|cerrada)\b|\b(?:compte|account|cuenta) (?:de secours|temporaire|provisoire|alternatif|de remplacement|securise|de securite|protege|backup|temporary|alternative|segura)\b|\b(?:safe|secure) account\b/,
  },
  {
    name: "beneficiaire-substitue",
    weight: 70,
    pattern:
      /\b(?:en lieu et place|a la place) d[eu]s? (?:fournisseur|beneficiaire)\b|\b(?:instead of|in place of) (?:the )?(?:supplier|vendor|usual)\b|\b(?:beneficiaire|payee)\b.{0,30}\b(?:filiale|partenaire|affacturage|tiers|partner|subsidiary|third party)\b|\bpas sur celui du registre\b|\bnot the (?:one|account) on (?:file|record)\b/,
  },
  { name: "iban-dans-le-document", weight: 30, pattern: /\b[a-z]{2}\d{2}(?: ?[a-z0-9]{4}){3,7}(?: ?[a-z0-9]{1,3})?\b/ },
  { name: "adresse-de-portefeuille", weight: 35, pattern: /\b0x[0-9a-f]{40}\b/ },
  {
    // Demander de payer une seconde fois.
    name: "paiement-a-refaire",
    weight: 70,
    pattern:
      /\b(?:payer|payez|regler|reglez|pay|pagar|paguen?)\b.{0,25}\b(?:de nouveau|a nouveau|une seconde fois|une deuxieme fois|again|once more|a second time|otra vez|de nuevo|nuevamente)\b|\bvuelvan? a pagar|\bvolver a pagar/,
  },
  {
    name: "meme-prestation-autre-numero",
    weight: 70,
    pattern:
      /\bnouveau numero\b.{0,80}\bmeme (?:prestation|facture|commande|livraison)\b|\bnew (?:number|reference)\b.{0,80}\bsame (?:goods|invoice|service|order)\b|\bnuevo numero\b.{0,80}\bmism[ao]\b/,
  },
  { name: "doublon-marque", weight: 30, pattern: /\b(?:second exemplaire|duplicata|duplicado|duplicate|re-?issue|re-?emission|copy of invoice)\b|\(copie\)/ },
  {
    name: "frais-ajoutes",
    weight: 40,
    pattern: /\b(?:frais|honoraires|couts?|charges?|fees?)\b.{0,30}\b(?:ajoutes?|supplementaires?|complementaires?|exceptionnels?|additional|extra|en sus)\b/,
  },
  {
    name: "ajout-au-reglement",
    weight: 50,
    pattern: /\b(?:ajoute[zr]?|rajoute[zr]?|add|anadan?|sumen?)\s(?:eur\s)?\d[\d .,]*\s?(?:eur|euros?|€|\$)?\s(?:au|a la|to|al|a su)\s(?:the\s)?(?:reglement|facture|paiement|payment|invoice|pago)\b/,
  },
  {
    name: "evitement-des-seuils",
    weight: 60,
    pattern:
      /\b(?:sous|en dessous|au-dessous|below|under)\b.{0,25}\b(?:seuils?|plafonds?|limites?|thresholds?|limits?)\b|\ben dessous de \d+ par (?:operation|transaction|paiement|virement)\b/,
  },
  {
    name: "fractionnement",
    weight: 45,
    pattern:
      /\b(?:fractionne[rz]?|fractionnement|scinde[rz]?|decoupe[rz]?|split)\b|\ben (?:plusieurs|[a-z]+|\d+) (?:versements|virements|paiements)\b|\binto (?:several|multiple|\d+) (?:transfers|payments)\b/,
  },
  {
    name: "repetition-jusqu-au-plafond",
    weight: 50,
    pattern: /\b(?:tant que|as often as|as long as|until|jusqu'a ce que)\b.{0,40}\b(?:plafond|budget|limite|limit|cap|seuil)\b/,
  },
];

const AMOUNT = String.raw`(\d[\d .,]*\d|\d)`;
const CUR = String.raw`(?:\s*(?:eur|euros?|usd|€|\$|ttc|ht))*`;
const PRE = String.raw`(?:(?:eur|usd|€|\$)\s*)?`;
const RAISED: { pattern: RegExp; newFirst: boolean }[] = [
  { pattern: new RegExp(AMOUNT + CUR + String.raw`\s*(?:au lieu de|et non(?: pas)?|instead of|rather than|y no|en lugar de|en vez de)\s*` + PRE + AMOUNT, "g"), newFirst: true },
  { pattern: new RegExp(AMOUNT + CUR + String.raw`\s*\(?\s*(?:previously|auparavant|precedemment|initialement|antes|anteriormente|was)\s*` + PRE + AMOUNT, "g"), newFirst: true },
  { pattern: new RegExp(String.raw`\b(?:passe|passant|goes|rises?|pasa) (?:de |from )?` + PRE + AMOUNT + CUR + String.raw`\s*(?:a|to)\s*` + PRE + AMOUNT, "g"), newFirst: false },
  { pattern: new RegExp(String.raw`\b(?:n'est pas|is not|not|no es)\s*` + PRE + AMOUNT + CUR + String.raw`\s*(?:mais|but|sino)\s*` + PRE + AMOUNT, "g"), newFirst: false },
];

/** Lit un montant écrit à la française (1 250,00) ou à l'anglaise (1,250.00). */
export function parseAmount(text: string): number {
  let t = text.replace(/\s/g, "");
  const decimal = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  // Le dernier séparateur est décimal s'il est suivi d'un ou deux chiffres.
  if (decimal >= 0 && t.length - decimal - 1 <= 2) {
    t = `${t.slice(0, decimal).replace(/[.,]/g, "")}.${t.slice(decimal + 1)}`;
  } else {
    t = t.replace(/[.,]/g, "");
  }
  return Number(t);
}

// Un montant corrigé : à la hausse, c'est le signal d'une facture gonflée ;
// à la baisse, une rectification ordinaire.
function amountRevision(text: string): "raised" | "lowered" | null {
  let lowered = false;
  for (const { pattern, newFirst } of RAISED) {
    for (const match of text.matchAll(pattern)) {
      const first = parseAmount(match[1] as string);
      const second = parseAmount(match[2] as string);
      if (!Number.isFinite(first) || !Number.isFinite(second) || first === second) continue;
      if ((newFirst ? first : second) > (newFirst ? second : first)) return "raised";
      lowered = true;
    }
  }
  return lowered ? "lowered" : null;
}

// Une phrase qui parle des attaques sans en être une : programme d'une
// formation, consigne de vigilance. Elle est retirée avant de chercher une
// instruction. Limite connue : une attaque rédigée comme un exercice passerait.
const ABOUT_ATTACKS =
  /\b(?:reconnaitre|reconnaissance|detecter|detection|reperer|identifier|se premunir|sensibilis\w+|exercices? sur|recogni[sz]e|recogni[sz]ing|detect(?:ing|ion)?|identify(?:ing)?|spot(?:ting)?|awareness|reconocer|detectar|concienciacion)\b/;

function withoutCitations(normalized: string): string {
  return normalized
    .split(/(?<=[.!?;:])\s+/)
    .filter((sentence) => !ABOUT_ATTACKS.test(sentence))
    .join(" ");
}

type Fired = { names: Set<string>; labels: Set<string> };

// Applique les règles et ne compte que celles qui n'ont pas déjà été comptées :
// un même passage relu sous une autre forme ne pèse pas deux fois.
function applyRules(text: string, rules: Rule[], prefix: string, fired: Fired): number {
  let total = 0;
  for (const rule of rules) {
    if (fired.names.has(rule.name)) continue;
    if (rule.pattern.test(text) && !(rule.unless?.test(text) ?? false)) {
      total += rule.weight;
      fired.names.add(rule.name);
      fired.labels.add(`${prefix}:${rule.name}`);
    }
  }
  return total;
}

type Derived = { kind: string; text: string };

const LEET: Record<string, string> = { "4": "a", "3": "e", "1": "i", "0": "o", "5": "s", "7": "t", "@": "a", $: "s" };
const LEET_TOKEN = /(?<![\w.,])(?=[\w@$]*\d)(?=[\w@$]*[A-Za-z])[\w@$]+/g;
const CELL_LABEL = /^.*\b(?:memo|note|obs\.?|observacion(?:es)?|remarque|comment(?:aire)?s?)\s*:\s*/i;

// Autres lectures du même document : ce qu'un lecteur automatique pourrait
// reconstituer et qu'un contrôle sur le texte brut ne verrait pas.
function derive(raw: string): Derived[] {
  const derived: Derived[] = [];
  const text = raw.normalize("NFKC");
  const lines = text.split(/\r?\n/);

  // Caractères « étiquette » : décodés vers l'ASCII qu'ils recopient.
  const tags = [...text].filter((c) => {
    const code = c.codePointAt(0) as number;
    return code >= 0xe0020 && code <= 0xe007e;
  });
  if (tags.length > 0) {
    derived.push({ kind: "caracteres-invisibles", text: tags.map((c) => String.fromCodePoint((c.codePointAt(0) as number) - 0xe0000)).join("") });
  }

  for (const comment of text.match(/<!--[\s\S]*?-->/g) ?? []) derived.push({ kind: "commentaire-html", text: comment });

  for (const run of text.match(BASE64_RUN) ?? []) {
    const decoded = Buffer.from(run, "base64").toString("utf8");
    // On ne retient que ce qui se décode en texte lisible.
    const printable = decoded.replace(/[^\x20-\x7E -ſ]/g, "");
    if (decoded.length >= 12 && printable.length / decoded.length > 0.9 && /[a-z]{3,} [a-z]{2,}/i.test(decoded)) {
      derived.push({ kind: "texte-encode", text: decoded });
    }
  }

  // Lettres séparées par des espaces : « i g n o r e   l e s ».
  const spaced = /(?<!\S)(?:\S {1,4}){5,}\S(?!\S)/g;
  if (spaced.test(text)) {
    spaced.lastIndex = 0;
    const joined = text.replace(spaced, (run) => run.replace(/ {2,}/g, "\u0000").replace(/ /g, "").replace(/\u0000/g, " "));
    derived.push({ kind: "lettres-espacees", text: joined });
  }

  // Lignes écrites de droite à gauche.
  derived.push({ kind: "texte-inverse", text: lines.map((line) => [...line].reverse().join("")).join("\n") });

  // Mots coupés par des traits d'union : « vé-ri-fi-ca-tion ».
  if ((text.match(/\p{L}-\p{L}/gu) ?? []).length >= 6) {
    derived.push({ kind: "mots-coupes", text: text.replace(/(\p{L})-(?=\p{L})/gu, "$1") });
  }

  // Chiffres mis à la place de lettres : « 1gn0r3 ».
  if ((text.match(LEET_TOKEN) ?? []).length >= 3) {
    derived.push({ kind: "chiffres-pour-lettres", text: text.replace(LEET_TOKEN, (token) => [...token].map((c) => LEET[c] ?? c).join("")) });
  }

  // Consigne découpée en fin de ligne ou dans la dernière colonne d'un tableau.
  if (lines.length >= 3) {
    const tail = lines
      .map((line) => {
        const cells = line
          .split(/\s*\|\s*|\s+[—–]\s+/)
          .map((c) => c.trim())
          .filter((c) => c !== "");
        return (cells.at(-1) ?? "").replace(CELL_LABEL, "").replace(/^\(\d+\/\d+\)\s*/, "");
      })
      .filter((cell) => cell !== "" && !/^[\d\s.,€$%:/-]+$/.test(cell));
    if (tail.length >= 3) derived.push({ kind: "consigne-fragmentee", text: tail.join(" ") });
  }
  return derived;
}

export function detect(input: DetectionInput): Detection {
  const fired: Fired = { names: new Set(), labels: new Set() };
  const raw = input.document;
  const visible = normalize(raw);

  let instruction = applyRules(withoutCitations(visible), INSTRUCTION_RULES, "instruction", fired);
  let anomaly = applyRules(visible, ANOMALY_RULES, "anomalie", fired);

  const mark = (name: string, weight: number): void => {
    if (fired.names.has(name)) return;
    fired.names.add(name);
    fired.labels.add(`instruction:${name}`);
    instruction += weight;
  };
  if (SHORT_DEADLINE.test(visible) && THREAT.test(visible)) mark("pression-delai-court", 45);

  // Écriture cachée : déjà suspecte en elle-même.
  const invisible = ZERO_WIDTH.test(raw) || TAG_CHARS.test(raw);
  ZERO_WIDTH.lastIndex = 0;
  TAG_CHARS.lastIndex = 0;
  if (invisible) mark("caracteres-invisibles", 30);
  const forced = BIDI.test(raw);
  BIDI.lastIndex = 0;
  if (forced) mark("sens-d-ecriture-force", 30);
  if (MIXED_ALPHABETS.test(raw.normalize("NFKC"))) mark("alphabets-melanges", 30);
  if (/<!--[\s\S]*?-->/.test(raw)) mark("commentaire-html", 30);
  if (/<\s*(?:script|style|span|div|font|p)\b[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*[01](?:px)?\b|color\s*:\s*(?:#fff|white))/i.test(raw)) {
    mark("texte-masque-par-style", 30);
  }

  // Autres lectures du document : seules les règles nouvelles comptent, avec
  // une majoration quand c'est la forme d'écriture qui les cachait.
  const bonused = new Set<string>();
  for (const segment of derive(raw)) {
    const text = normalize(segment.text);
    const before = fired.names.size;
    instruction += applyRules(withoutCitations(text), INSTRUCTION_RULES, `instruction-${segment.kind}`, fired);
    anomaly += applyRules(text, ANOMALY_RULES, `anomalie-${segment.kind}`, fired);
    if (fired.names.size > before && !bonused.has(segment.kind)) {
      bonused.add(segment.kind);
      instruction += HIDING_BONUS;
    }
  }

  const revision = amountRevision(visible);
  if (revision === "raised") {
    anomaly += 70;
    fired.labels.add("anomalie:montant-revu-a-la-hausse");
  } else if (revision === null && /\b(?:nouveau total|total revise|new total|revised total|majoration|majore)\b/.test(visible)) {
    // Total annoncé comme révisé, sans les deux montants pour en juger le sens.
    anomaly += 40;
    fired.labels.add("anomalie:total-revise");
  }

  // Doublon et rafale réunis restent sous le seuil : une facture redemandée
  // (scénario 8) doit atteindre le contrat, qui la refuse lui-même.
  if (input.history?.duplicate === true) {
    anomaly += 30;
    fired.labels.add("anomalie:doublon");
  }
  if (input.history?.burst === true) {
    anomaly += 25;
    fired.labels.add("anomalie:rafale");
  }

  // Un agent demande ce que son mandat ne permet pas : règle sans nuance.
  let authority = 0;
  if (input.action !== null && !input.mandate.includes(input.action)) {
    authority = 100;
    fired.labels.add("autorite:action-hors-mandat");
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
  return { score, reason_codes, signals, rules: [...fired.labels].sort() };
}
