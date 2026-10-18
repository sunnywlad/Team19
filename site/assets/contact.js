// Lit config.js et remplit le bouton de rendez-vous et l'adresse de contact.
// Aucune donnée n'est saisie ni envoyée : le rendez-vous se prend chez le service tiers.
(() => {
  const cfg = window.VETO_CONFIG || {};
  const renseignee = (v) => typeof v === "string" && v !== "" && !v.includes("a-completer.invalid");

  let rdv = null;
  try {
    const u = new URL(cfg.RDV_URL);
    if (u.protocol === "https:" && renseignee(cfg.RDV_URL)) rdv = u.href;
  } catch { /* valeur absente ou mal formée : pas de bouton */ }
  const mail = renseignee(cfg.CONTACT_EMAIL) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.CONTACT_EMAIL) ? cfg.CONTACT_EMAIL : null;

  const lien = document.getElementById("lien-rdv");
  if (lien && rdv) {
    lien.href = rdv;
    lien.target = "_blank";
    lien.rel = "noopener noreferrer";
    lien.hidden = false;
    document.getElementById("rdv-indisponible").hidden = true;
  }

  if (!mail) return;
  document.querySelectorAll("[data-contact]").forEach((el) => { el.textContent = mail; });

  const bouton = document.getElementById("b-copier"), etat = document.getElementById("etat-copie");
  if (!bouton) return;
  bouton.hidden = false;
  bouton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(mail);
      etat.textContent = "Adresse copiée.";
    } catch {
      // Presse-papiers refusé : on sélectionne l'adresse pour une copie au clavier.
      const r = document.createRange();
      r.selectNodeContents(document.getElementById("adresse-contact"));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      etat.textContent = "Adresse sélectionnée : copiez-la avec Ctrl+C (ou ⌘+C).";
    }
  });
})();
