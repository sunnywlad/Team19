# dashboard/ : console Veto, en lecture seule

Montre ce que les agents ont demandé, ce que le contrat a décidé et pourquoi,
ce qui a été arrêté avant lui, la réponse déclenchée et les délais mesurés.
Elle lit, elle n'agit pas : aucune commande ne paie, ne met en pause ni
n'approuve, le client HTTP n'a que des `GET` et la console ne détient aucune
clé. Les décisions humaines se signeront dans une app d'approbation séparée,
hors de ce dossier (option A).

Direction visuelle D « Console » : maquette, jetons et correspondance de chaque
élément avec sa source dans [docs/console/](../docs/console/) ;
[correspondance-console.md](../docs/console/correspondance-console.md) fait foi.
Captures en mode fixtures : [docs/console/captures/](../docs/console/captures/).

## Écrans

| Groupe | Écran | Ce qu'il montre | Sources |
|---|---|---|---|
| Pilotage | Vue d'ensemble | Paiements exécutés, part sans intervention, à valider, bloqués par une règle ; décisions par jour ; plaçable ; agents ; décisions du contrat ; demandes arrêtées avant lui | `/events`, `/decisions`, `/queue`, `/vault`, `/journal/entries`, `/incidents` |
| | À valider | Cas 1 ouverts, validés, rejetés, expirés ; tiroir : contrôles, faits inscrits, historique, échéance estimée, pied de l'option A (bouton « Ouvrir dans l'app d'approbation » désactivé, « À venir »). Touches J et K | `/decisions`, `/events`, `/journal/entries` |
| | Incidents | Maître-détail, gravité indicative dérivée du déclencheur, extrait en quarantaine, réponse automatique, délais ; vue rapport imprimable | `/incidents`, `/agents/paused`, `/events` |
| Référentiels | Fournisseurs | Bénéficiaires inscrits, factures, paiements | `/events` |
| | Agents | Agents inscrits, mandat, paiements, blocages, pauses | `/events`, `/decisions`, `/agents/paused`, `/journal/entries` |
| Contrôle | Règles | Seuil de validation, réserve de sécurité, délai de réponse, pause du coffre | `/vault`, `/events` |
| | Piste d'audit | Verdict de vérification, tête, têtes des rapports, entrées filtrées par composant | `/journal/verification`, `/journal/entries`, `/incidents` |
| Preuves | Campagne | Chiffres figés d'une campagne hors ligne, avec leurs réserves | aucun appel |

Chaque chiffre dérivé se calcule dans [src/domain/](src/domain/) (`apercu.ts`,
`validation.ts`, `referentiels.ts`), testé dans
[test/derivations.test.ts](test/derivations.test.ts). Un montant illisible ou
une référence inconnue n'entre dans aucun total : « montant inconnu », jamais 0.
Ce que la correspondance marque VISION (écart à l'habitude, doublon,
réactivation à deux, plafonds, exports, SSO, rôles) n'apparaît pas ;
[test/referentiels.test.tsx](test/referentiels.test.tsx) le vérifie sur toute
la console.

Barre haute : recherche, puce d'environnement, date, thème. La recherche
filtre en local les fournisseurs, factures et agents déjà lus : aucune requête,
la saisie ne quitte pas la page. Choisir une trouvaille ouvre Fournisseurs ou
Agents, filtré, avec « Effacer la recherche ». C'est le seul champ de saisie de
la console, et il n'est dans aucun formulaire
([test/recherche.test.tsx](test/recherche.test.tsx)).

Clavier : barre latérale à une étape de tabulation, flèches, Début, Fin ; P
pour le mode présentation, Échap pour en sortir ; J et K dans « À valider ».
Sur écran étroit, la barre latérale devient une rangée d'onglets.

## Lancer

```bash
npm ci --ignore-scripts
```

Simulé (deux terminaux) :

```bash
npm run dev:fixtures            # scène 3, puis 4, puis 1 ; ou : npm run dev:fixtures -- 6
npm run dev:sim                 # http://127.0.0.1:5173
```

Scénarios servis : `1` à `8`, `6a` (approuvé), `6b` (délai dépassé), `scene`.
Relancer le serveur de fixtures rejoue le script.

Réel, contre l'API du relais (`cd ../relay && npm start`, port 8787) et le
service de réponse (`cd ../response && npm start`, port 8790) :

```bash
RELAY_HAS_VAULT=1 RELAY_VAULT_MODE=chain RESPONSE_API_URL=http://127.0.0.1:8790 npm run dev
# unité déclarée, libellés d'un autre fichier (facultatif) :
# UNITE_SYMBOLE=u UNITE_DECIMALES=15 LIBELLES_FILE=/chemin/libelles.json
```

`RELAY_VAULT_MODE` dit ce que le relais a derrière lui : `chain` (un contrat) ou
`fake` (son faux coffre en mémoire, `VAULT_MODE=fake`). Le proxy local le sert à
la page par `GET /api/local/mode` ; la valeur n'est pas dans le bundle et l'API
du relais n'a aucun champ de plus. Avec `fake`, la puce d'environnement affiche
en permanence « Coffre simulé : aucun fonds, aucune chaîne », en teinte
d'avertissement, et les panneaux alimentés par le faux coffre (plaçable,
décisions, cas en attente, pauses sur la chaîne) ont la provenance
« simulation » ; la file et le journal gardent « réel ». Sans la variable, la
puce dit « Origine non confirmée » et ces panneaux l'écrivent en toutes lettres :
jamais « réel » par défaut. `make demo` la pose.

Sans ces deux variables, le coffre et le service de réponse restent simulés :
lancer alors aussi `npm run dev:fixtures`.

Variables : [.env.example](.env.example). Elles ne sont lues que par le proxy
local de [vite.config.ts](vite.config.ts) ; rien n'entre dans le bundle.

## Vérifier

```bash
make dashboard                  # depuis la racine ; fait partie de make check
```

Lance [tools/check.sh](tools/check.sh) : lint de sécurité, types, tests vitest,
puis build et contrôle du bundle (aucune valeur d'environnement, CSP présente,
aucune ressource externe).

## Ce qui est réel, ce qui est simulé

| Donnée | Source |
|---|---|
| Décisions, événements, file, état de l'indexeur | API de `relay/` |
| Montant plaçable et ses termes | `GET /vault` du relais avec `RELAY_HAS_VAULT=1`, simulé sinon |
| Incidents, délais, journal, agents en pause, demandes arrêtées à la porte | `response/` avec `RESPONSE_API_URL`, simulé sinon |

### Où se lit la provenance

La provenance est regroupée, jamais retirée :

- **Une puce d'environnement** dans la barre haute : « Démo · données fictives »
  (fixtures), « Coffre simulé » (faux coffre), « Réseau de test » (contrat sur
  la chaîne de test), « Origine non confirmée » sinon. « · en partie simulé » s'y
  ajoute quand un point d'accès reste simulé à côté d'un relais réel. Le pied de
  page reprend le même texte.
- **Le panneau « Sources »**, ouvert au clic sur la puce : pour le relais, le
  coffre et le service de réponse, l'origine, la dernière lecture réussie et la
  fraîcheur ; l'état des libellés et de l'unité.
- **Sur chaque panneau, une icône** : le mot (« Source : relais, réel, lu à
  14:30:13 ») est dans l'infobulle et le texte accessible, et un clic ouvre le
  panneau « Sources ». Seule « origine non confirmée » reste écrite sur le
  panneau, en petit et en gris, comme une valeur « non disponible ».
- **Jamais « réel » par défaut** : une origine que le proxy n'a pas dite reste
  « non confirmée ».
- **Notes techniques repliées** : formules, horloges et explications de calcul
  sont sous « Détails », fermé par défaut, au contenu inchangé. L'horloge d'un
  horodatage est une icône à infobulle (« horloge : bloc ») ; le tableau des
  délais l'écrit en toutes lettres.

Les bandeaux « données indisponibles », « relais indisponible » et « coffre en
pause » restent : ce sont des alertes, pas de la provenance.

[test/vault-origin.test.tsx](test/vault-origin.test.tsx) vérifie ces règles.

## Libellés et unité d'affichage

Servis par le proxy local, en `GET`, jamais par le relais ni écrits sur la
chaîne ([API-NEEDS.md](API-NEEDS.md) § 7 et § 8) :

- `GET /api/local/libelles` : le fichier `LIBELLES_FILE`, par défaut
  [fixtures/libelles.json](fixtures/libelles.json), synthétique, aux
  identifiants de `specs/examples/fixtures.json`. Libellé absent : identifiant
  abrégé (F-999, volontairement absente, le montre). Champs facultatifs :
  `sous_titre`, et pour un fournisseur `iban_masque` et `siren`, affichés dans
  Fournisseurs et dans le tiroir de « À valider » ([API-NEEDS.md](API-NEEDS.md) § 7).
- `GET /api/local/unite` : `UNITE_SYMBOLE` et `UNITE_DECIMALES`, par défaut « u »
  et 15 (1 u = 10¹⁵ wei, l'unité du monde de test). Jamais « € » par défaut. Avec
  `UNITE_SYMBOLE=€`, montants au format monétaire français (`48 600,00 €`),
  deux décimales au moins, jamais arrondis.

Chaque réponse est validée par son schéma
([schemas/local-libelles.schema.json](schemas/local-libelles.schema.json),
[schemas/local-unite.schema.json](schemas/local-unite.schema.json)). Proxy
muet ou réponse non conforme : unité par défaut (le pied le dit) et
identifiants abrégés.

## Polices

Geist et Geist Mono, servies depuis [public/fonts/](public/fonts/) : aucune
ressource externe, la CSP n'autorise que `font-src 'self'`. Licence SIL OFL 1.1,
[public/fonts/LICENSE.txt](public/fonts/LICENSE.txt).

| Provenance | Valeur |
|---|---|
| Paquet npm | `geist`, version `1.7.2` (récupéré par `npm pack`, pas installé comme dépendance) |
| Intégrité du paquet | `sha512-Gu5lDFa3pLRyoBlBPf0QIFHVdWAnpco7fS1bJm41jyLPFoguBgiubseUN2oLXMgqZ7uxAxDoXcHMhCY/fOTTgg==` |
| Fichiers repris | `dist/fonts/geist-sans/Geist-{Regular,Medium,SemiBold}.woff2`, `dist/fonts/geist-mono/GeistMono-{Regular,Medium}.woff2`, `LICENSE.txt` |

## Garde-fous

- **Données hostiles.** Chaque réponse est validée avant affichage (ajv, schémas de `specs/schemas` et de [schemas/](schemas/)). Une réponse non conforme n'est pas affichée : erreur explicite. Les validateurs sont précompilés ([tools/gen-validators.mjs](tools/gen-validators.mjs)) pour tenir sous une CSP sans `unsafe-eval`.
- **Texte non fiable.** Borné, monospace, étiqueté, caractères bidirectionnels et de largeur nulle rendus visibles ([src/lib/safeText.ts](src/lib/safeText.ts)).
- **Lint** ([tools/lint.mjs](tools/lint.mjs)) : échoue sur `dangerouslySetInnerHTML`, `innerHTML`, une URL construite, une méthode autre que `GET`, une ressource externe, une variable `VITE_*`.
- **Fraîcheur.** Lecture toutes les 2 s, recul exponentiel en cas d'erreur. Au-delà de 10 s sans lecture réussie : bandeau « données indisponibles » et valeurs grisées.
- **Décision.** Lue dans les événements `Decision`, jamais dans un reçu. Motif inconnu, ou décision qui ne va pas avec son motif : traité comme un refus.
- **Délais.** Une durée n'est calculée qu'entre deux horodatages de la même horloge (journal ou bloc), et l'affiche.
- **Accessibilité.** Décision en mots et icône, pas seulement en couleur ; animations et transitions coupées si le système demande un mouvement réduit ; touche P : mode présentation (Échap pour sortir) ; thème clair, sombre ou système ; barre latérale au clavier (flèches, Début, Fin) ; tiroir modal (focus piégé, Échap) ; tableaux en fiches sur écran étroit ; graphique avec légende en mots et tableau de remplacement.
- **Réseau.** Serveur lié à `127.0.0.1`, CSP stricte, aucune ressource externe, proxy qui refuse tout sauf `GET`.
