Veto place des gardiens entre les agents IA et la trésorerie. Ce système est la direction A, « Table ronde » : il part du logo (une table ovale violette, un V blanc, cinq sièges gris) et en fait un composant, une grammaire de couleurs et un ton.

**Ambiance** : calme · ferme · transparent · ovale · sérigraphié.

**Concept.** Plusieurs gardiens délibèrent autour d'une table ; un seul veto suffit. Chaque siège est une couche réelle du paiement (Porte d'entrée, IA du client, Relais, Contrat, Humain) et change d'état seulement quand la couche a réellement statué. Le dashboard lit tout et ne décide rien, et le système en fait une force visible plutôt qu'une limite.

## Principes

1. **Lire dans l'ordre de l'œil.** L'argent d'abord (`BandeauTresorerie`), la décision humaine ensuite (`CarteValidation`), puis la table ronde, les incidents, le journal.
2. **Calme par défaut.** Fond `fond`, jamais de blanc ni de noir purs. Une seule lueur (`lueur`, couleur `lueur-couleur`) : la validation qui attend un humain.
3. **La couleur porte un sens, jamais un décor.** Sarcelle = payé et sain (`accepte`), moutarde = attente humaine (`humain`), orange brûlé = veto, refus, incident (`refuse`). Chaque statut a aussi un glyphe et un mot.
4. **Le mouvement ne montre que des faits.** Un siège qui passe (`duree-base`), un veto qui tombe (`duree-veto`), rien qui boucle. `prefers-reduced-motion` coupe tout.
5. **Honnêteté visible.** Chaque panneau porte une `EtiquetteSource` : en production une pastille calme (« relais · lu 14:12 »), en démo ou en cas de doute réel, simulation, origine non confirmée, non mesuré. Une valeur absente s'affiche « Non mesuré » ou « — », jamais 0, jamais un chiffre inventé.
6. **Le dashboard ne détient aucune clé.** Aucun bouton n'approuve, ne paie ni ne lève une pause. L'écran montre la décision et écrit « À signer par l'approbateur ».
7. **Une validation, une question.** Montant et bénéficiaire viennent du registre du contrat ; le silence vaut refus et l'écran le dit.
8. **Personne ne reste devant l'écran.** Le client vise un jour ouvré pour trancher : l'échéance est une date (`Echeance`), la validation arrive par notification (`NotificationValidation`), l'écran sert à lire et à vérifier.

## Les six éléments signature

- **La table ronde** (`TableRonde`) : ovale `table` portant le V `table-v`, cinq sièges. États : au repos (gris `siege`), passé (sarcelle, coche), veto (orange, siège levé, croix), en attente (moutarde, sablier, lueur), non atteint (pointillé). La légende écrit l'état de chaque siège en mots.
- **Le veto** : trois gestes qui disent la même chose. Le siège se lève, le tampon ovale `TamponVeto` se pose avec le code motif, la pastille 0 apparaît. Fort, jamais alarmiste : aplat `refuse-fond`, pas de rouge vif, pas de clignotement.
- **0 / 1 / 2** (`PastilleDecision`) : un chiffre en Plex Mono, un glyphe (croix, sablier, coche), un mot (Refusé, Validation humaine, Payé). Même pastille dans les tables, notifications, exports et le rapport PDF.
- **Fermé par défaut** : la bande « Fermé par défaut » de `CarteValidation`, la mention APPROVAL_TIMEOUT sous la décision 0, l'état d'erreur « Rien n'est autorisé par défaut ». Le silence est montré comme une règle rassurante, pas comme un échec.
- **La chaîne de preuve** (`LigneJournal`) : des maillons reliés par un trait, des empreintes abrégées, une rupture qui change de forme (icône brisée, trait pointillé, contour orange) et qui se lit en une phrase.
- **L'argent qui ne bouge pas** (`BarreTresorerie`) : la formule cash = dettes admises + réserve + placements bloqués + plaçable s'écrit terme par terme au-dessus d'une barre à l'échelle ; quatre formes (plein violet, hachures, plein moutarde, plein sarcelle).

## Fondamentaux du texte

- **Ton** : un notaire, pas un agent secret. Phrases courtes, verbes d'action, pas d'exclamation, pas d'emoji. « Nous » pour Veto, « vous » pour l'approbateur ou le propriétaire.
- **Casse** : majuscule de phrase partout ; les étiquettes `etiquette` sont en petites capitales espacées, pas en gras criard. Les codes motif restent tels quels, en Plex Mono : `INVOICE_UNKNOWN`, `ABOVE_THRESHOLD`, `APPROVAL_TIMEOUT`.
- **Aucune promesse plus forte que la preuve.** Chaque chiffre porte sa condition : « 50 attaques détectées sur 100, jeu de test synthétique ». On écrit « Non mesuré » plutôt qu'un nombre inventé.
- **Formulations interdites** : « protégé contre l'injection », « zéro attaque réussie », « conforme », « certifié », « détecte les zero-days », « le contrat paie » sans « sur réseau de test ».
- **Phrase de fond** : « Nous n'empêchons pas l'injection, nous bornons ses conséquences. » Promesse : « Plusieurs gardiens autour de chaque paiement d'agent IA. Un seul veto suffit. »
- **Exemples réels** : « À signer par l'approbateur. Ce tableau ne détient aucune clé : il montre la décision, il ne la prend pas. » · « Fermé par défaut. Sans réponse avant l'échéance, la demande est refusée et le montant est libéré. » · « Aucun fonds n'a bougé. »
- « Argent Intelligent » n'apparaît qu'en sous-titre, jamais comme marque.

## Iconographie

- Huit icônes de couche dans `assets/Icons/` : agent, porte d'entrée, signature, relais, contrat, humain, quarantaine, journal. Grille 24 px, trait de 1,75 px, extrémités et jonctions arrondies, aucun aplat. Encre unique `#1e1730` (valeur de `texte` en clair) : une image `<img>` n'hérite pas de `currentColor`, les aperçus les incorporent en SVG pour suivre le thème.
- Les glyphes de décision (croix, sablier, coche) sont posés sur un aplat `-signal` à 3:1, dans un disque.
- Pas de cadenas, pas de bouclier, pas de tuiles d'icônes empilées. L'absence de clé se dit avec une clé barrée.
- Logos : `assets/Logos/veto-logo.jpg` (logo complet, fond blanc, à ne pas poser sur le thème sombre) et `assets/Logos/veto-marque-dashboard.svg` (marque du dashboard, copiée du dépôt). La marque du bandeau (`Navigation`) reprend cette géométrie avec des classes liées aux jetons.

## Données et graphiques

- Palette séquentielle `viz-seq-1` à `viz-seq-5` (violet, du léger au fort) ; catégorielle `viz-cat-1` à `viz-cat-4` (violet, prune, bleu, olive), validées pour le daltonisme sur `surface`, sans les trois teintes de décision.
- Un graphique, une unité, un axe. Barres horizontales, marques fines, valeurs écrites, texte jamais de la couleur de la série. Détails dans `GraphiqueDelais`.

## Not synced

Le dépôt n'a ni fichier de police ni bibliothèque de composants exportée : le dashboard utilise des polices système et des composants propres à l'application. Les polices (Jost, IBM Plex Mono, OFL) sont ajoutées en fichiers locaux. Les composants sont écrits à la main pour cette direction, à partir du brief et des composants du dashboard (`PlaceableBar`, `CountdownRing`, `DecisionBadge`, `FlowDiagram`), sans bundle JavaScript : `components/bundle.css` suffit, les aperçus sont du HTML statique. Les valeurs de couleur sont une proposition, pas celles du dépôt ; l'écart est dans la section Migration.

## Production et démo

Les aperçus sont en **mode Production** : montants dans l'unité du contrat (€ dans les exemples), pastilles de source discrètes, aucun bandeau « simulé ». Le **mode Démo** (`EcranCockpitDemo`) garde le bandeau « COFFRE SIMULÉ » et les pastilles « simulation ». Le mode vient de l'environnement du proxy local (`RELAY_VAULT_MODE`), jamais d'un champ de l'API ; sans lui, les panneaux portent « origine non confirmée ».

## Accès, mise en service et preuves

- **Connexion** (`EcranConnexion`) : une seule action, l'identité de l'entreprise (SSO). Accès en lecture seule : un compte Veto n'est pas une clé.
- **Mise en service** (`EcranMiseEnService`) : une checklist de vérification (le dashboard ne fait que des `GET`) ; ce qui se règle hors dashboard est dit comme tel.
- **Preuves et limites** (`EcranPreuves`) : chaque chiffre avec sa condition et ce qu'il ne dit pas ; la liste de ce que Veto ne prétend pas.
- **Mobile** (`EcranMobile`) : validations et alertes, rien d'autre.
- **Notifications** (`NotificationValidation`) : e-mail, mobile, rappel. Les rappels sont une décision du relais.
