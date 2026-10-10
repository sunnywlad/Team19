// Texte venu d'ailleurs (extrait de facture, cause d'un rejet, valeur hors
// format) : borné, et ses caractères invisibles rendus visibles. React échappe
// déjà le HTML ; ce module traite ce que l'échappement ne traite pas : un
// caractère bidirectionnel ou de largeur nulle qui ferait lire autre chose que
// ce qui est écrit.

export const EXCERPT_MAX = 200;

function isInvisible(cp: number): boolean {
  return (
    (cp <= 0x1f && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || // contrôles C0
    (cp >= 0x7f && cp <= 0x9f) || // DEL et contrôles C1
    cp === 0x00ad || // trait d'union conditionnel
    cp === 0x034f || // diacritique de jointure
    cp === 0x061c || // marque arabe (bidirectionnel)
    cp === 0x180e ||
    (cp >= 0x200b && cp <= 0x200f) || // largeur nulle, marques gauche-droite et droite-gauche
    (cp >= 0x2028 && cp <= 0x202e) || // séparateurs, enchâssements et forçages bidirectionnels
    (cp >= 0x2060 && cp <= 0x206f) || // liant, opérateurs invisibles, isolats bidirectionnels
    cp === 0xfeff || // marque d'ordre des octets
    (cp >= 0xfff9 && cp <= 0xfffb) || // annotations interlinéaires
    (cp >= 0xe0000 && cp <= 0xe007f) // étiquettes invisibles
  );
}

export type SafeText = {
  /** Texte à afficher tel quel, comme nœud de texte. */
  text: string;
  truncated: boolean;
  /** Nombre de caractères invisibles rendus visibles. */
  neutralized: number;
};

/** Coupe à « max » caractères, puis remplace chaque caractère invisible par ⟦U+XXXX⟧. */
export function neutralize(input: string, max: number = EXCERPT_MAX): SafeText {
  const points = Array.from(input);
  const kept = points.slice(0, max);
  let neutralized = 0;
  let text = "";
  for (const ch of kept) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isInvisible(cp)) {
      neutralized += 1;
      text += `⟦U+${cp.toString(16).toUpperCase().padStart(4, "0")}⟧`;
    } else if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      text += " ";
    } else {
      text += ch;
    }
  }
  return { text, truncated: points.length > max, neutralized };
}
