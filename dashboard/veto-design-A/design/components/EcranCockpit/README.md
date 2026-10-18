Le cockpit est l'écran d'accueil : il lit dans l'ordre de l'œil. D'abord la trésorerie, ensuite la décision à rendre, puis la table ronde, les incidents et le journal.

**Fournir** : les lectures du relais, du coffre et du service de réponse, chacune avec l'heure de sa dernière lecture.

- Hiérarchie fixe : 1. L'argent est-il en sécurité ? (bandeau de trésorerie, fixe sur chaque écran de travail) 2. Une action humaine est-elle requise ? (carte de validation et son échéance) 3. La table ronde de la demande sélectionnée 4. Incidents ouverts, puis journal.
- Le calme est une exigence fonctionnelle : grandes surfaces peu saturées, `fond` lilas gris, une seule lueur (la carte en attente), aucun élément qui pulse.
- Pas de carte dans une carte : des sections séparées par un filet de 2px, une seule vraie carte (la validation).
- Chaque panneau dit d'où vient sa donnée et quand elle a été lue (« relais · lu 14:12 »). Ce n'est pas un avertissement : c'est une date de fraîcheur. Passé 10 s sans lecture réussie, la pastille devient « données indisponibles » et les valeurs sont grisées.
- Mode Production : montants dans l'unité du contrat, aucun bandeau « simulé ». Le mode Démo (`EcranCockpitDemo`) ajoute le bandeau de faux coffre et les pastilles « simulation ». Le mode vient de l'environnement du proxy local, jamais d'un champ de l'API.
- 1440 px en priorité, dégradation propre jusqu'à 1024 px (une colonne). Sur mobile : alertes et validations seulement (`EcranMobile`).
