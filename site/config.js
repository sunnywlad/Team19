// Seules valeurs à régler du site public (voir README.md, « Valeurs à compléter »).
// Ce fichier est servi tel quel à tous les visiteurs : ni secret, ni jeton, ni clé.
// Tant qu'une valeur pointe vers « a-completer.invalid », le site la traite comme absente :
// pas de bouton de rendez-vous, et un texte d'attente à la place de l'adresse.
window.VETO_CONFIG = Object.freeze({
  // À COMPLÉTER : lien public de prise de rendez-vous (outil tiers), en https.
  RDV_URL: "https://a-completer.invalid/rendez-vous",
  // À COMPLÉTER : adresse e-mail de contact affichée sur /demo, /mentions-legales et /confidentialite.
  CONTACT_EMAIL: "contact@a-completer.invalid",
});
