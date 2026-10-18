# Veto, direction A « Table ronde » : implémenter dans `dashboard/`

Contenu du dossier `design/` : `tokens.json` et `tokens.css` (jetons clair/sombre), `components/bundle.css` (le CSS de référence), `components/<Nom>/preview.html` + `README.md` (un composant ou un écran chacun, à ouvrir dans un navigateur), `fonts/` (Jost et IBM Plex Mono, OFL, en `.woff2` locaux), `assets/` (logo, 8 icônes), et les docs (`README.md`, `Fondations-visuelles.md`, `Migration-dashboard.md`, `Justification-et-risques.md`).

## À trancher AVANT de coder (décisions humaines, pas du code)

1. **Unité des montants.** Le dashboard affiche des « u » (`1 u = 10¹⁵ wei`, `lib/format.ts`). Les aperçus montrent des « € » pour la lisibilité : **ne pas les reprendre**. Garder le formatage existant tant que l'équipe n'a pas défini l'unité réelle.
2. **Délai d'approbation.** Le client vise un jour ouvré. Le contrat/relais doit renvoyer une échéance absolue correspondante (`specs/` : décision à quatre). Le dashboard affiche l'échéance reçue et ne calcule aucun jour ouvré.
3. **Rappels et notifications** (e-mail, mobile) : c'est `relay/` ou `response/`, pas le dashboard. Le dashboard n'affiche une ligne « Rappel prévu » que si l'API en fournit un.
4. **Connexion SSO** : suppose un fournisseur d'identité devant le proxy local (hors dépôt aujourd'hui). Pas d'écran de connexion sans cela.
5. **Page Rôles** : aucune donnée n'existe côté API. Hors périmètre tant que `API-NEEDS.md` n'a pas le point d'accès.

## Correspondance maquettes → vues existantes

| Maquette | Vue actuelle (`src/views/`) |
|---|---|
| Cockpit | `SupervisionView` + `DecisionsView` |
| Validation | `PendingView` (« En attente ») |
| Incidents | `IncidentView` |
| Journal | `JournalView` |
| Preuves et limites | `CampagneView` (résultats figés : garder l'étiquette « simulation ») |
| Mise en service | nouvelle vue, 100 % `GET` déjà servis |
| Connexion, Rôles | **pas maintenant** (décisions 4 et 5) |
| Table ronde | remplace `FlowDiagram` |
| Échéance | remplace `CountdownRing` |
| Mobile | CSS responsive (≤ 480 px) sur En attente et Incidents |

## Phases (une PR par phase, CI verte à chaque fois)

1. **Fondations.** Reprendre les jetons de `design/tokens.css` dans `src/styles.css` en gardant les noms existants. Copier les `.woff2` dans `public/` (ou `src/`) et ajouter `@font-face` local ; vérifier que la CSP de `vite.config.ts` autorise `font-src 'self'` et rien d'externe. Thème clair/sombre/système inchangé (`useTheme`).
2. **Composants partagés.** `TableRonde` (SVG, 5 sièges, états repos/passé/veto/attente/non atteint, légende avec mots + glyphes), `PastilleDecision` (0/1/2), pastille de source « relais · lu HH:MM », bandeau de trésorerie fixe, bloc « À signer par l'approbateur, hors dashboard » avec ligne pointillée.
3. **Échéance.** Composant `Echeance` (24 cases, états normal/proche/échue, phrase « sans signature : refusé »). Entrée : l'échéance donnée par l'API. Aucun `setInterval` à la seconde : rafraîchir à la minute.
4. **Vues.** Supervision/Décisions, En attente, Incidents, Journal, dans l'ordre. Bandeau de trésorerie en tête de chacune.
5. **Mise en service et Preuves.** Checklist en lecture seule (relais joignable, service de réponse joignable, mode coffre, journal intègre, seuil lu, approbateurs, notifications) ; chaque ligne « À faire » dit où agir, hors dashboard. Preuves : chiffres de `CampagneView` avec condition et « ce que ça ne dit pas ».
6. **Mobile.** Alertes et validations seulement.

## Règles du dépôt à respecter (extraits de `CLAUDE.md`)

- `dashboard/` est le dossier de Joseph : n'écrire que dedans ; tout changement ailleurs se dit d'abord. Les specs ne changent pas sans décision à quatre.
- Une branche par brique depuis `origin/main` (`git fetch` d'abord). **Ne pas commiter ni pousser sans demande.** Jamais de `push --force`.
- Aucun secret, ne jamais lire `.env`, données synthétiques uniquement, aucune donnée nominative (bénéficiaires = identifiants opaques).
- Le dashboard ne fait que des `GET` : aucun bouton n'approuve, ne paie, ne met en pause ni ne lève une pause (`test/readonly.test.tsx` doit rester vert). « Revérifier » = relire une donnée.
- **CSP stricte, `tools/lint.mjs`** : pas d'attribut `style=` (les aperçus en contiennent quelques-uns : les remplacer par des classes), pas de ressource externe, pas de `dangerouslySetInnerHTML`, pas d'URL construite, pas de `VITE_*`. Géométrie SVG par attributs.
- Ne jamais présenter un chiffre de détection sans sa réserve (`gateway/bench/README.md`). Formulations interdites : « protégé contre l'injection », « zéro attaque réussie », « conforme », « certifié », « détecte les zero-days », « le contrat paie » sans « sur réseau de test ».
- Texte non fiable : toujours via `lib/safeText.ts`.
- Accessibilité : WCAG 2.1 AA, focus visible, cibles ≥ 24 px, statut jamais par la couleur seule, `prefers-reduced-motion` coupe les animations.

## Vérifier

`make dashboard` (lint, types, vitest, build, contrôle du bundle), puis `npm run dev:sim` et comparer chaque écran à son `preview.html` en clair et en sombre, à 1440 et 1024 px.

## Prompt à coller dans Claude Code (depuis `dashboard/`, avec ce dossier copié dans `dashboard/design/` ; le dossier ne doit pas entrer dans le build)

```
Lis CLAUDE.md, dashboard/README.md, dashboard/API-NEEDS.md puis design/HANDOFF.md et design/README.md.
Objectif : implémenter le système de design Veto (direction A « Table ronde ») dans dashboard/, phase par phase.
Commence par la phase 1 uniquement. Avant de coder : fais `git fetch`, crée une branche feat/dashboard-veto-fondations depuis origin/main,
liste les fichiers que tu comptes modifier et les décisions de HANDOFF.md §« À trancher » qui te bloquent.
Contraintes : ne touche qu'à dashboard/, aucun style=, aucune ressource externe, GET uniquement, noms de jetons existants conservés,
« u » et non « € » pour les montants. Fais passer `make dashboard`. Ne commite pas, ne pousse pas : montre-moi le diff.
Compare chaque écran modifié au preview.html correspondant (clair et sombre) avant de me le présenter.
```
