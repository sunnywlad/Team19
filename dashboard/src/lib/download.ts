// Enregistrement local d'une donnée déjà lue. Aucun appel réseau : le fichier
// est fabriqué dans le navigateur, à partir de la réponse validée de l'API.

/** Nom de fichier sûr : préfixe fixe et identifiant opaque hexadécimal seulement. */
export function reportFileName(incidentId: string): string | null {
  return /^(0x)?[0-9a-f]{16,}$/.test(incidentId) ? `rapport-incident-${incidentId}.json` : null;
}

export function saveJson(fileName: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.click();
  // Le lien n'est jamais ajouté à la page ; l'adresse locale est libérée aussitôt après.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
