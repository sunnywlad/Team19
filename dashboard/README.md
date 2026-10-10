# dashboard/ : tableau de bord en lecture seule

Montre une décision du contrat, son motif, la réponse déclenchée et les délais
mesurés. Il lit, il n'agit pas : aucune commande ne paie, ne met en pause ni
n'approuve, et le client HTTP n'a que des `GET`.

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
RELAY_HAS_VAULT=1 RESPONSE_API_URL=http://127.0.0.1:8790 npm run dev
```

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

Chaque panneau porte son étiquette « réel » ou « simulation ».

## Garde-fous

- **Données hostiles.** Chaque réponse est validée avant affichage (ajv, schémas de `specs/schemas` et de [schemas/](schemas/)). Une réponse non conforme n'est pas affichée : erreur explicite. Les validateurs sont précompilés ([tools/gen-validators.mjs](tools/gen-validators.mjs)) pour tenir sous une CSP sans `unsafe-eval`.
- **Texte non fiable.** Borné, monospace, étiqueté, caractères bidirectionnels et de largeur nulle rendus visibles ([src/lib/safeText.ts](src/lib/safeText.ts)).
- **Lint** ([tools/lint.mjs](tools/lint.mjs)) : échoue sur `dangerouslySetInnerHTML`, `innerHTML`, une URL construite, une méthode autre que `GET`, une ressource externe, une variable `VITE_*`.
- **Fraîcheur.** Lecture toutes les 2 s, recul exponentiel en cas d'erreur. Au-delà de 10 s sans lecture réussie : bandeau « données indisponibles » et valeurs grisées.
- **Décision.** Lue dans les événements `Decision`, jamais dans un reçu. Motif inconnu, ou décision qui ne va pas avec son motif : traité comme un refus.
- **Délais.** Une durée n'est calculée qu'entre deux horodatages de la même horloge (journal ou bloc), et l'affiche.
- **Accessibilité.** Décision en mots et icône, pas seulement en couleur ; thème clair, sombre ou système ; barre d'écrans au clavier (flèches, Début, Fin) ; tableaux en fiches sur écran étroit.
- **Réseau.** Serveur lié à `127.0.0.1`, CSP stricte, aucune ressource externe, proxy qui refuse tout sauf `GET`.
